-- Covering partial indexes per grain so range aggregation is index-only.
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_date
  ON public.gsc_api_facts (organization_id, date) INCLUDE (clicks, impressions, position)
  WHERE grain = 'date';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_query
  ON public.gsc_api_facts (organization_id, date) INCLUDE (query, clicks, impressions, position)
  WHERE grain = 'query';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_page
  ON public.gsc_api_facts (organization_id, date) INCLUDE (page, clicks, impressions, position)
  WHERE grain = 'page';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_query_page
  ON public.gsc_api_facts (organization_id, date) INCLUDE (query, page, clicks, impressions, position)
  WHERE grain = 'query_page';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_device
  ON public.gsc_api_facts (organization_id, date) INCLUDE (device, clicks, impressions, position)
  WHERE grain = 'device';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_country
  ON public.gsc_api_facts (organization_id, date) INCLUDE (country, clicks, impressions, position)
  WHERE grain = 'country';
CREATE INDEX IF NOT EXISTS gsc_api_facts_g_appearance
  ON public.gsc_api_facts (organization_id, date) INCLUDE (search_appearance, clicks, impressions, position)
  WHERE grain = 'search_appearance';

-- Deterministic URL key, mirroring the import-side normalization.
CREATE OR REPLACE FUNCTION public.gsc_api_norm_url(_u text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN x ~ '^https?://[^/]+/?$' THEN x
           ELSE regexp_replace(x, '/+$', '')
         END
  FROM (SELECT lower(split_part(btrim(_u), '#', 1))) t(x);
$$;

-- Coverage of the API layer, per grain.
CREATE OR REPLACE FUNCTION public.gsc_api_coverage(_org_id uuid)
RETURNS TABLE(grain text, first_date date, last_date date, row_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT f.grain, MIN(f.date), MAX(f.date), COUNT(*)::bigint
    FROM public.gsc_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id
   GROUP BY f.grain;
$$;

CREATE OR REPLACE FUNCTION public.gsc_api_daily_totals(_org_id uuid, _start date, _end date)
RETURNS TABLE(clicks bigint, impressions bigint, ctr numeric, avg_position numeric,
              days integer, first_date date, last_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(f.clicks),0)::bigint,
         COALESCE(SUM(f.impressions),0)::bigint,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END,
         COUNT(DISTINCT f.date)::integer,
         MIN(f.date), MAX(f.date)
    FROM public.gsc_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id AND f.grain = 'date'
     AND f.date BETWEEN _start AND _end;
$$;

CREATE OR REPLACE FUNCTION public.gsc_api_daily_series(_org_id uuid, _start date, _end date)
RETURNS TABLE(date date, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT f.date, SUM(f.clicks)::bigint, SUM(f.impressions)::bigint,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END
    FROM public.gsc_api_facts f
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id AND f.grain = 'date'
     AND f.date BETWEEN _start AND _end
   GROUP BY f.date ORDER BY f.date;
$$;

-- Query grain over actual API dates, with an optional comparison window.
CREATE OR REPLACE FUNCTION public.gsc_api_query_report(
  _org_id uuid, _start date, _end date,
  _compare_start date DEFAULT NULL, _compare_end date DEFAULT NULL, _limit integer DEFAULT 2000)
RETURNS TABLE(query text, normalized_query text, classification query_classification,
              clicks integer, impressions integer, ctr numeric, position_value numeric,
              prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cur AS (
    SELECT lower(btrim(f.query)) AS nq, MIN(f.query) AS q,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE public.has_org_access(_org_id)
       AND f.organization_id = _org_id AND f.grain = 'query'
       AND f.date BETWEEN _start AND _end AND f.query IS NOT NULL
     GROUP BY 1
  ), ranked AS (
    SELECT c.*, row_number() OVER (ORDER BY c.clicks DESC) rc,
           row_number() OVER (ORDER BY c.impressions DESC) ri
      FROM cur c
  ), top AS (
    SELECT * FROM ranked WHERE rc <= _limit OR ri <= _limit
  ), prev AS (
    SELECT lower(btrim(f.query)) AS nq,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE _compare_start IS NOT NULL AND _compare_end IS NOT NULL
       AND f.organization_id = _org_id AND f.grain = 'query'
       AND f.date BETWEEN _compare_start AND _compare_end AND f.query IS NOT NULL
     GROUP BY 1
  )
  SELECT t.q, t.nq, public.gsc_classify_query(_org_id, t.q),
         t.clicks::integer, t.impressions::integer,
         CASE WHEN t.impressions > 0 THEN t.clicks / t.impressions END,
         CASE WHEN t.impressions > 0 THEN t.wpos / t.impressions END,
         p.clicks::integer, p.impressions::integer,
         CASE WHEN p.impressions > 0 THEN p.clicks / p.impressions END,
         CASE WHEN p.impressions > 0 THEN p.wpos / p.impressions END
    FROM top t
    LEFT JOIN prev p ON p.nq = t.nq;
$$;

-- Page grain with URL → community mapping applied at read time.
CREATE OR REPLACE FUNCTION public.gsc_api_page_report(
  _org_id uuid, _start date, _end date,
  _compare_start date DEFAULT NULL, _compare_end date DEFAULT NULL,
  _community_id uuid DEFAULT NULL, _limit integer DEFAULT 5000)
RETURNS TABLE(page_url text, normalized_url text,
              clicks integer, impressions integer, ctr numeric, position_value numeric,
              mapped_community_id uuid, community_name text, mapped_content_type text,
              mapped_intent_type text, mapped_topic text, mapping_rule_id uuid,
              prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cur AS (
    SELECT public.gsc_api_norm_url(f.page) AS nu, MIN(f.page) AS page,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE public.has_org_access(_org_id)
       AND (_community_id IS NULL OR public.has_community_access(_community_id))
       AND f.organization_id = _org_id AND f.grain = 'page'
       AND f.date BETWEEN _start AND _end AND f.page IS NOT NULL
     GROUP BY 1
  ), ranked AS (
    SELECT c.*, row_number() OVER (ORDER BY c.clicks DESC) rc,
           row_number() OVER (ORDER BY c.impressions DESC) ri FROM cur c
  ), top AS (
    SELECT * FROM ranked WHERE rc <= _limit OR ri <= _limit
  ), mapped AS (
    SELECT t.*, r.id AS rule_id, r.community_id, r.content_type, r.intent_type, r.topic
      FROM top t
      LEFT JOIN LATERAL (
        SELECT r.* FROM public.url_mapping_rules r
         WHERE r.organization_id = _org_id AND r.active
           AND ((r.match_type = 'exact_url'    AND t.nu = r.pattern)
             OR (r.match_type = 'url_contains' AND position(lower(r.pattern) in t.nu) > 0)
             OR (r.match_type = 'path_prefix'  AND t.nu LIKE lower(r.pattern) || '%')
             OR (r.match_type = 'regex'        AND t.nu ~* r.pattern))
         ORDER BY r.priority ASC, r.created_at ASC LIMIT 1
      ) r ON true
  ), prev AS (
    SELECT public.gsc_api_norm_url(f.page) AS nu,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE _compare_start IS NOT NULL AND _compare_end IS NOT NULL
       AND f.organization_id = _org_id AND f.grain = 'page'
       AND f.date BETWEEN _compare_start AND _compare_end AND f.page IS NOT NULL
     GROUP BY 1
  )
  SELECT m.page, m.nu, m.clicks::integer, m.impressions::integer,
         CASE WHEN m.impressions > 0 THEN m.clicks / m.impressions END,
         CASE WHEN m.impressions > 0 THEN m.wpos / m.impressions END,
         m.community_id, com.name, m.content_type, m.intent_type, m.topic, m.rule_id,
         p.clicks::integer, p.impressions::integer,
         CASE WHEN p.impressions > 0 THEN p.clicks / p.impressions END,
         CASE WHEN p.impressions > 0 THEN p.wpos / p.impressions END
    FROM mapped m
    LEFT JOIN public.communities com ON com.id = m.community_id
    LEFT JOIN prev p ON p.nu = m.nu
   WHERE _community_id IS NULL OR m.community_id = _community_id;
$$;

-- Canonical query + page grain (never reconstructed from separate reports).
CREATE OR REPLACE FUNCTION public.gsc_api_query_page_report(
  _org_id uuid, _start date, _end date, _community_id uuid DEFAULT NULL, _limit integer DEFAULT 2000)
RETURNS TABLE(query text, page_url text, normalized_url text,
              clicks integer, impressions integer, ctr numeric, position_value numeric,
              mapped_community_id uuid, community_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cur AS (
    SELECT lower(btrim(f.query)) AS nq, MIN(f.query) AS q,
           public.gsc_api_norm_url(f.page) AS nu, MIN(f.page) AS page,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE public.has_org_access(_org_id)
       AND (_community_id IS NULL OR public.has_community_access(_community_id))
       AND f.organization_id = _org_id AND f.grain = 'query_page'
       AND f.date BETWEEN _start AND _end
       AND f.query IS NOT NULL AND f.page IS NOT NULL
     GROUP BY 1, 3
  ), ranked AS (
    SELECT c.*, row_number() OVER (ORDER BY c.clicks DESC) rc,
           row_number() OVER (ORDER BY c.impressions DESC) ri FROM cur c
  ), top AS (
    SELECT * FROM ranked WHERE rc <= _limit OR ri <= _limit
  ), mapped AS (
    SELECT t.*, r.community_id
      FROM top t
      LEFT JOIN LATERAL (
        SELECT r.* FROM public.url_mapping_rules r
         WHERE r.organization_id = _org_id AND r.active
           AND ((r.match_type = 'exact_url'    AND t.nu = r.pattern)
             OR (r.match_type = 'url_contains' AND position(lower(r.pattern) in t.nu) > 0)
             OR (r.match_type = 'path_prefix'  AND t.nu LIKE lower(r.pattern) || '%')
             OR (r.match_type = 'regex'        AND t.nu ~* r.pattern))
         ORDER BY r.priority ASC, r.created_at ASC LIMIT 1
      ) r ON true
  )
  SELECT m.q, m.page, m.nu, m.clicks::integer, m.impressions::integer,
         CASE WHEN m.impressions > 0 THEN m.clicks / m.impressions END,
         CASE WHEN m.impressions > 0 THEN m.wpos / m.impressions END,
         m.community_id, com.name
    FROM mapped m
    LEFT JOIN public.communities com ON com.id = m.community_id
   WHERE _community_id IS NULL OR m.community_id = _community_id;
$$;

-- Device / country / search appearance grains.
CREATE OR REPLACE FUNCTION public.gsc_api_dimension_report(
  _org_id uuid, _start date, _end date, _dimension text, _limit integer DEFAULT 500)
RETURNS TABLE(dimension_value text, clicks integer, impressions integer, ctr numeric, position_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cur AS (
    SELECT CASE _dimension WHEN 'device' THEN f.device
                           WHEN 'country' THEN f.country
                           WHEN 'search_appearance' THEN f.search_appearance END AS dim,
           SUM(f.clicks)::numeric AS clicks, SUM(f.impressions)::numeric AS impressions,
           SUM(f.position * f.impressions) AS wpos
      FROM public.gsc_api_facts f
     WHERE public.has_org_access(_org_id)
       AND _dimension IN ('device', 'country', 'search_appearance')
       AND f.organization_id = _org_id AND f.grain = _dimension
       AND f.date BETWEEN _start AND _end
     GROUP BY 1
  )
  SELECT c.dim, c.clicks::integer, c.impressions::integer,
         CASE WHEN c.impressions > 0 THEN c.clicks / c.impressions END,
         CASE WHEN c.impressions > 0 THEN c.wpos / c.impressions END
    FROM cur c
   WHERE c.dim IS NOT NULL
   ORDER BY c.impressions DESC
   LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.gsc_api_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_daily_totals(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_daily_series(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_query_report(uuid, date, date, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_page_report(uuid, date, date, date, date, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_query_page_report(uuid, date, date, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_dimension_report(uuid, date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_norm_url(text) TO authenticated;