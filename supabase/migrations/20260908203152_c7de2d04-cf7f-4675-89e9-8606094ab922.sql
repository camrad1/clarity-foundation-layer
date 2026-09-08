DROP FUNCTION IF EXISTS public.community_trend_matrix(uuid, date, integer, uuid[]);

CREATE OR REPLACE FUNCTION public.ct_bucket(_d date, _grain text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE _grain
           WHEN 'day' THEN _d
           -- Sunday-start weeks, matching the existing validated weekly logic.
           WHEN 'week' THEN _d - (EXTRACT(dow FROM _d)::int)
           ELSE date_trunc('month', _d)::date
         END;
$function$;

CREATE OR REPLACE FUNCTION public.community_trend_series(
  _org_id uuid,
  _start date,
  _end date,
  _grain text DEFAULT 'month',
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  community_id uuid,
  community_name text,
  bucket date,
  inquiries integer,
  tours integer,
  re_tours integer,
  deposits integer,
  move_ins integer,
  move_outs integer,
  net_move_ins integer,
  sessions bigint,
  engaged_sessions bigint,
  further_leads bigint,
  occupancy_pct numeric,
  occupied_units integer,
  census_units integer,
  occupancy_source text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  s record;
  tour_ids text[];
  ok_ids text[];
  g text;
  t_lo timestamptz;
  t_hi timestamptz;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  PERFORM set_config('statement_timeout', '60s', true);

  g := CASE WHEN _grain IN ('day','week','month') THEN _grain ELSE 'month' END;
  _end := COALESCE(_end, current_date);
  _start := COALESCE(_start, _end - 364);
  IF _start > _end THEN RETURN; END IF;
  -- Bounded window: at most ~3 years of days.
  IF _end - _start > 1100 THEN _start := _end - 1100; END IF;

  t_lo := (_start - 2)::timestamptz;
  t_hi := (_end + 2)::timestamptz;

  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope, 1), 0) = 0 THEN RETURN; END IF;

  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(m.activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings m
   WHERE m.organization_id = _org_id AND m.category = 'tour';
  ok_ids := public.wh_successful_result_ids(_org_id);

  RETURN QUERY
  WITH buckets AS (
    SELECT DISTINCT public.ct_bucket(d::date, g) AS b
      FROM generate_series(_start, _end, interval '1 day') d
  ),
  comms AS (
    SELECT c.id, c.name, c.timezone FROM public.communities c WHERE c.id = ANY(scope)
  ),
  grid AS (
    SELECT comms.id AS cid, comms.name AS cname, buckets.b
      FROM comms CROSS JOIN buckets
  ),
  pc AS (
    SELECT pr.community_id AS cid,
           (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END
            AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS d
      FROM public.wh_prospects pr
      JOIN comms c ON c.id = pr.community_id
     WHERE pr.organization_id = _org_id
       AND (NOT s.exclude_merged_prospects OR pr.merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR pr.discarded_at IS NULL)
       AND (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END) BETWEEN t_lo AND t_hi
  ),
  inq AS (
    SELECT pc.cid, public.ct_bucket(pc.d, g) AS b, count(*)::int AS n
      FROM pc WHERE pc.d BETWEEN _start AND _end GROUP BY 1, 2
  ),
  tr AS (
    SELECT ac.community_id AS cid, public.ct_bucket(ac.completed_local_date, g) AS b,
           count(*)::int AS n,
           count(*) FILTER (WHERE ac.first_completed_of_type IS FALSE)::int AS rn
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND ac.community_id = ANY(scope)
       AND ac.discarded_at IS NULL
       AND ac.completed_at IS NOT NULL
       AND ac.completed_local_date BETWEEN _start AND _end
       AND tour_ids IS NOT NULL
       AND ac.activity_type_id = ANY(tour_ids)
       AND ac.result_id IS NOT NULL
       AND ac.result_id = ANY(ok_ids)
     GROUP BY 1, 2
  ),
  dep AS (
    SELECT q.cid, q.b, count(*)::int AS n
      FROM (
        SELECT DISTINCT dt.community_id AS cid,
               public.ct_bucket(dt.occurred_local_date, g) AS b,
               COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS k
          FROM public.wh_deposit_transactions dt
         WHERE dt.organization_id = _org_id
           AND dt.community_id = ANY(scope)
           AND dt.discarded_at IS NULL
           AND dt.transaction_type = 'Deposit'
           AND dt.deposit_type = 'Deposit'
           AND COALESCE(dt.amount, 0) > 0
           AND dt.occurred_local_date BETWEEN _start AND _end
      ) q
     GROUP BY 1, 2
  ),
  kc AS (
    SELECT hc.community_id AS cid, hc.count_move_in, hc.count_move_out,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  ),
  mi AS (
    SELECT kc.cid, public.ct_bucket(kc.mi_date, g) AS b, count(*)::int AS n
      FROM kc WHERE kc.count_move_in IS TRUE AND kc.mi_date BETWEEN _start AND _end
     GROUP BY 1, 2
  ),
  mo AS (
    SELECT kc.cid, public.ct_bucket(kc.mo_date, g) AS b, count(*)::int AS n
      FROM kc WHERE kc.count_move_out IS TRUE AND kc.mo_date BETWEEN _start AND _end
     GROUP BY 1, 2
  ),
  ga AS (
    SELECT f.mapped_community_id AS cid, public.ct_bucket(f.date, g) AS b,
           SUM(f.sessions)::bigint AS ses, SUM(f.engaged_sessions)::bigint AS eng
      FROM public.ga4_api_facts f
     WHERE f.organization_id = _org_id
       AND f.mapped_community_id = ANY(scope)
       AND f.report = 'landing_page'
       AND f.date BETWEEN _start AND _end
       AND NOT COALESCE(f.is_partial_day, false)
     GROUP BY 1, 2
  ),
  fl AS (
    SELECT l.community_id AS cid,
           public.ct_bucket((l.created_on AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date, g) AS b,
           count(*)::bigint AS n
      FROM public.further_leads l
      JOIN comms c ON c.id = l.community_id
     WHERE l.organization_id = _org_id
       AND l.created_on BETWEEN t_lo AND t_hi
       AND ((l.created_on AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date) BETWEEN _start AND _end
     GROUP BY 1, 2
  ),
  occ_raw AS (
    SELECT x.*, public.ct_bucket(x.d, g) AS b
      FROM public.wh_occupancy_history_daily(_org_id, scope, _start, _end) x
  ),
  occ AS (
    -- Last canonical value in the period: day = that day, week = end of week,
    -- month = end of month. Percentages are never averaged.
    SELECT DISTINCT ON (o.community_id, o.b)
           o.community_id AS cid, o.b, o.occupied, o.census, o.src
      FROM occ_raw o
     ORDER BY o.community_id, o.b, o.d DESC
  )
  SELECT g2.cid, g2.cname, g2.b,
         COALESCE(inq.n, 0), COALESCE(tr.n, 0), COALESCE(tr.rn, 0), COALESCE(dep.n, 0),
         COALESCE(mi.n, 0), COALESCE(mo.n, 0), COALESCE(mi.n, 0) - COALESCE(mo.n, 0),
         COALESCE(ga.ses, 0), COALESCE(ga.eng, 0), COALESCE(fl.n, 0),
         CASE WHEN occ.census IS NOT NULL AND occ.census > 0
              THEN round(occ.occupied / occ.census * 100, 1) END,
         round(occ.occupied)::int,
         round(occ.census)::int,
         occ.src
    FROM grid g2
    LEFT JOIN inq ON inq.cid = g2.cid AND inq.b = g2.b
    LEFT JOIN tr  ON tr.cid  = g2.cid AND tr.b  = g2.b
    LEFT JOIN dep ON dep.cid = g2.cid AND dep.b = g2.b
    LEFT JOIN mi  ON mi.cid  = g2.cid AND mi.b  = g2.b
    LEFT JOIN mo  ON mo.cid  = g2.cid AND mo.b  = g2.b
    LEFT JOIN ga  ON ga.cid  = g2.cid AND ga.b  = g2.b
    LEFT JOIN fl  ON fl.cid  = g2.cid AND fl.b  = g2.b
    LEFT JOIN occ ON occ.cid = g2.cid AND occ.b = g2.b
   ORDER BY g2.cname, g2.b;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_trend_series(uuid, date, date, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_trend_series(uuid, date, date, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_trend_series(uuid, date, date, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_trend_series(uuid, date, date, text, uuid[]) TO service_role;