-- Apply deterministic URL rules to GA4 landing-page rows (community mapping only).
CREATE OR REPLACE FUNCTION public.ga4_apply_page_mappings(_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE updated integer;
BEGIN
  WITH matched AS (
    SELECT f.id AS fact_id, r.community_id
      FROM public.ga4_api_facts f
      LEFT JOIN LATERAL (
        SELECT r.* FROM public.url_mapping_rules r
         WHERE r.organization_id = f.organization_id
           AND r.active
           AND r.community_id IS NOT NULL
           AND (
             (r.match_type = 'exact_url'    AND split_part(f.landing_page_path, '?', 1) = r.pattern)
          OR (r.match_type = 'url_contains' AND position(lower(r.pattern) in lower(split_part(f.landing_page_path, '?', 1))) > 0)
          OR (r.match_type = 'path_prefix'  AND lower(split_part(f.landing_page_path, '?', 1)) LIKE lower(r.pattern) || '%')
          OR (r.match_type = 'regex'        AND split_part(f.landing_page_path, '?', 1) ~* r.pattern)
           )
         ORDER BY r.priority ASC, r.created_at ASC
         LIMIT 1
      ) r ON true
     WHERE f.organization_id = _org_id
       AND f.report = 'landing_page'
       AND f.landing_page_path IS NOT NULL
  )
  UPDATE public.ga4_api_facts f
     SET mapped_community_id = m.community_id
    FROM matched m
   WHERE f.id = m.fact_id
     AND f.mapped_community_id IS DISTINCT FROM m.community_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;

-- Coverage / health summary per grain.
CREATE OR REPLACE FUNCTION public.ga4_coverage(_org_id uuid)
RETURNS TABLE(report text, first_date date, last_date date, row_count bigint, partial_rows bigint, mapped_rows bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT f.report, MIN(f.date), MAX(f.date), COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE f.is_partial_day)::bigint,
         COUNT(f.mapped_community_id)::bigint
    FROM public.ga4_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id
   GROUP BY f.report;
$$;

CREATE OR REPLACE FUNCTION public.ga4_health(_org_id uuid)
RETURNS TABLE(first_date date, last_date date, last_complete_date date, partial_date date,
              total_rows bigint, landing_rows bigint, mapped_landing_rows bigint, missing_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT * FROM public.ga4_api_facts
     WHERE public.has_org_access(_org_id) AND organization_id = _org_id
  ), d AS (
    SELECT DISTINCT date FROM f WHERE report = 'daily_totals'
  )
  SELECT (SELECT MIN(date) FROM d),
         (SELECT MAX(date) FROM d),
         (SELECT MAX(date) FROM f WHERE report = 'daily_totals' AND NOT COALESCE(is_partial_day, false)),
         (SELECT MAX(date) FROM f WHERE report = 'daily_totals' AND COALESCE(is_partial_day, false)),
         (SELECT COUNT(*)::bigint FROM f),
         (SELECT COUNT(*)::bigint FROM f WHERE report = 'landing_page'),
         (SELECT COUNT(*)::bigint FROM f WHERE report = 'landing_page' AND mapped_community_id IS NOT NULL),
         (SELECT (((SELECT MAX(date) FROM d) - (SELECT MIN(date) FROM d) + 1) - (SELECT COUNT(*) FROM d))::integer);
$$;

-- Daily totals. Community scope uses the landing_page grain (never property-wide splits).
CREATE OR REPLACE FUNCTION public.ga4_daily_totals(
  _org_id uuid, _start date, _end date,
  _community_id uuid DEFAULT NULL, _include_partial boolean DEFAULT false)
RETURNS TABLE(sessions bigint, active_users bigint, new_users bigint, engaged_sessions bigint,
              screen_page_views bigint, engagement_rate numeric, days integer,
              partial_days integer, first_date date, last_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH rows AS (
    SELECT f.* FROM public.ga4_api_facts f
     WHERE public.has_org_access(_org_id)
       AND f.organization_id = _org_id
       AND f.date BETWEEN _start AND _end
       AND (_include_partial OR NOT COALESCE(f.is_partial_day, false))
       AND ((_community_id IS NULL AND f.report = 'daily_totals')
         OR (_community_id IS NOT NULL AND f.report = 'landing_page' AND f.mapped_community_id = _community_id))
  )
  SELECT COALESCE(SUM(sessions), 0)::bigint,
         COALESCE(SUM(active_users), 0)::bigint,
         COALESCE(SUM(new_users), 0)::bigint,
         COALESCE(SUM(engaged_sessions), 0)::bigint,
         COALESCE(SUM(screen_page_views), 0)::bigint,
         CASE WHEN COALESCE(SUM(sessions), 0) > 0
              THEN SUM(engaged_sessions)::numeric / SUM(sessions)::numeric END,
         COUNT(DISTINCT date)::integer,
         COUNT(DISTINCT date) FILTER (WHERE COALESCE(is_partial_day, false))::integer,
         MIN(date), MAX(date)
    FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.ga4_daily_series(
  _org_id uuid, _start date, _end date, _community_id uuid DEFAULT NULL)
RETURNS TABLE(date date, sessions bigint, active_users bigint, new_users bigint,
              engaged_sessions bigint, screen_page_views bigint, engagement_rate numeric,
              is_partial_day boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT f.date,
         COALESCE(SUM(f.sessions), 0)::bigint,
         COALESCE(SUM(f.active_users), 0)::bigint,
         COALESCE(SUM(f.new_users), 0)::bigint,
         COALESCE(SUM(f.engaged_sessions), 0)::bigint,
         COALESCE(SUM(f.screen_page_views), 0)::bigint,
         CASE WHEN COALESCE(SUM(f.sessions), 0) > 0
              THEN SUM(f.engaged_sessions)::numeric / SUM(f.sessions)::numeric END,
         bool_or(COALESCE(f.is_partial_day, false))
    FROM public.ga4_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id
     AND f.date BETWEEN _start AND _end
     AND ((_community_id IS NULL AND f.report = 'daily_totals')
       OR (_community_id IS NOT NULL AND f.report = 'landing_page' AND f.mapped_community_id = _community_id))
   GROUP BY f.date
   ORDER BY f.date;
$$;

-- Dimension breakdowns; each grain stays separate.
CREATE OR REPLACE FUNCTION public.ga4_dimension_report(
  _org_id uuid, _start date, _end date, _dimension text,
  _limit integer DEFAULT 100, _include_partial boolean DEFAULT false)
RETURNS TABLE(dimension_value text, secondary_value text, sessions bigint, active_users bigint,
              new_users bigint, engaged_sessions bigint, screen_page_views bigint, engagement_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH rows AS (
    SELECT CASE _dimension
             WHEN 'source_medium' THEN f.session_source_medium
             WHEN 'source_medium_campaign' THEN f.session_source_medium
             WHEN 'channel_group' THEN f.default_channel_group
             WHEN 'device' THEN f.device_category END AS dim,
           CASE WHEN _dimension = 'source_medium_campaign' THEN f.session_campaign END AS dim2,
           f.sessions, f.active_users, f.new_users, f.engaged_sessions, f.screen_page_views
      FROM public.ga4_api_facts f
     WHERE public.has_org_access(_org_id)
       AND _dimension IN ('source_medium', 'source_medium_campaign', 'channel_group', 'device')
       AND f.organization_id = _org_id
       AND f.report = _dimension
       AND f.date BETWEEN _start AND _end
       AND (_include_partial OR NOT COALESCE(f.is_partial_day, false))
  )
  SELECT dim, dim2,
         COALESCE(SUM(sessions), 0)::bigint,
         COALESCE(SUM(active_users), 0)::bigint,
         COALESCE(SUM(new_users), 0)::bigint,
         COALESCE(SUM(engaged_sessions), 0)::bigint,
         COALESCE(SUM(screen_page_views), 0)::bigint,
         CASE WHEN COALESCE(SUM(sessions), 0) > 0
              THEN SUM(engaged_sessions)::numeric / SUM(sessions)::numeric END
    FROM rows
   WHERE dim IS NOT NULL
   GROUP BY dim, dim2
   ORDER BY 3 DESC
   LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.ga4_landing_page_report(
  _org_id uuid, _start date, _end date, _community_id uuid DEFAULT NULL,
  _limit integer DEFAULT 200, _include_partial boolean DEFAULT false)
RETURNS TABLE(landing_path text, mapped_community_id uuid, sessions bigint, active_users bigint,
              new_users bigint, engaged_sessions bigint, screen_page_views bigint, engagement_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT split_part(f.landing_page_path, '?', 1) AS landing_path,
         f.mapped_community_id,
         COALESCE(SUM(f.sessions), 0)::bigint,
         COALESCE(SUM(f.active_users), 0)::bigint,
         COALESCE(SUM(f.new_users), 0)::bigint,
         COALESCE(SUM(f.engaged_sessions), 0)::bigint,
         COALESCE(SUM(f.screen_page_views), 0)::bigint,
         CASE WHEN COALESCE(SUM(f.sessions), 0) > 0
              THEN SUM(f.engaged_sessions)::numeric / SUM(f.sessions)::numeric END
    FROM public.ga4_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id
     AND f.report = 'landing_page'
     AND f.date BETWEEN _start AND _end
     AND (_include_partial OR NOT COALESCE(f.is_partial_day, false))
     AND (_community_id IS NULL OR f.mapped_community_id = _community_id)
   GROUP BY 1, 2
   ORDER BY 3 DESC
   LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.ga4_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_health(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_daily_totals(uuid, date, date, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_daily_series(uuid, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_dimension_report(uuid, date, date, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_landing_page_report(uuid, date, date, uuid, integer, boolean) TO authenticated;