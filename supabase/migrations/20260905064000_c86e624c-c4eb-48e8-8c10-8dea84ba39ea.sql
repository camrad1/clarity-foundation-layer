DROP FUNCTION IF EXISTS public.ga4_daily_totals(uuid, date, date, uuid, boolean);
DROP FUNCTION IF EXISTS public.ga4_daily_series(uuid, date, date, uuid);
DROP FUNCTION IF EXISTS public.ga4_landing_page_report(uuid, date, date, uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.ga4_daily_totals(
  _org_id uuid, _start date, _end date,
  _community_ids uuid[] DEFAULT NULL, _include_partial boolean DEFAULT false)
RETURNS TABLE(sessions bigint, active_users bigint, new_users bigint, engaged_sessions bigint,
              screen_page_views bigint, engagement_rate numeric, days integer,
              partial_days integer, first_date date, last_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH scoped AS (
    SELECT f.* FROM public.ga4_api_facts f
     WHERE public.has_org_access(_org_id)
       AND f.organization_id = _org_id
       AND f.date BETWEEN _start AND _end
       AND (_include_partial OR NOT COALESCE(f.is_partial_day, false))
       AND ((_community_ids IS NULL AND f.report = 'daily_totals')
         OR (_community_ids IS NOT NULL AND f.report = 'landing_page'
             AND f.mapped_community_id = ANY(_community_ids)))
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
    FROM scoped;
$$;

CREATE OR REPLACE FUNCTION public.ga4_daily_series(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL)
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
     AND ((_community_ids IS NULL AND f.report = 'daily_totals')
       OR (_community_ids IS NOT NULL AND f.report = 'landing_page'
           AND f.mapped_community_id = ANY(_community_ids)))
   GROUP BY f.date
   ORDER BY f.date;
$$;

CREATE OR REPLACE FUNCTION public.ga4_landing_page_report(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL,
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
     AND (_community_ids IS NULL OR f.mapped_community_id = ANY(_community_ids))
   GROUP BY 1, 2
   ORDER BY 3 DESC
   LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.ga4_daily_totals(uuid, date, date, uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_daily_series(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_landing_page_report(uuid, date, date, uuid[], integer, boolean) TO authenticated;