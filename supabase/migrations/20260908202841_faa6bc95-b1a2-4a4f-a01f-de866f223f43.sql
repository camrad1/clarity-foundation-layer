CREATE OR REPLACE FUNCTION public.community_trend_matrix(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  community_id uuid,
  community_name text,
  month date,
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
  p_start date;
  p_end date;
  t_lo timestamptz;
  t_hi timestamptz;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  PERFORM set_config('statement_timeout', '60s', true);

  _months := least(greatest(COALESCE(_months, 12), 1), 36);
  _end := COALESCE(_end, current_date);
  p_start := (date_trunc('month', _end)::date - make_interval(months => _months - 1))::date;
  p_end := (date_trunc('month', _end)::date + interval '1 month - 1 day')::date;
  -- Raw-timestamp prefilter with a two-day cushion so no community timezone can
  -- shift a row out of the window. Local-date bucketing below is unchanged.
  t_lo := (p_start - 2)::timestamptz;
  t_hi := (p_end + 2)::timestamptz;

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
  WITH months AS (
    SELECT generate_series(p_start, date_trunc('month', p_end)::date, interval '1 month')::date AS m
  ),
  comms AS (
    SELECT c.id, c.name, c.timezone
      FROM public.communities c
     WHERE c.id = ANY(scope)
  ),
  grid AS (
    SELECT comms.id AS cid, comms.name AS cname, months.m
      FROM comms CROSS JOIN months
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
    SELECT pc.cid, date_trunc('month', pc.d)::date AS m, count(*)::int AS n
      FROM pc WHERE pc.d BETWEEN p_start AND p_end GROUP BY 1, 2
  ),
  tr AS (
    SELECT ac.community_id AS cid,
           date_trunc('month', ac.completed_local_date)::date AS m,
           count(*)::int AS n,
           count(*) FILTER (WHERE ac.first_completed_of_type IS FALSE)::int AS rn
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND ac.community_id = ANY(scope)
       AND ac.discarded_at IS NULL
       AND ac.completed_at IS NOT NULL
       AND ac.completed_local_date BETWEEN p_start AND p_end
       AND tour_ids IS NOT NULL
       AND ac.activity_type_id = ANY(tour_ids)
       AND ac.result_id IS NOT NULL
       AND ac.result_id = ANY(ok_ids)
     GROUP BY 1, 2
  ),
  dep AS (
    SELECT q.cid, q.m, count(*)::int AS n
      FROM (
        SELECT DISTINCT dt.community_id AS cid,
               date_trunc('month', dt.occurred_local_date)::date AS m,
               COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS k
          FROM public.wh_deposit_transactions dt
         WHERE dt.organization_id = _org_id
           AND dt.community_id = ANY(scope)
           AND dt.discarded_at IS NULL
           AND dt.transaction_type = 'Deposit'
           AND dt.deposit_type = 'Deposit'
           AND COALESCE(dt.amount, 0) > 0
           AND dt.occurred_local_date BETWEEN p_start AND p_end
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
    SELECT kc.cid, date_trunc('month', kc.mi_date)::date AS m, count(*)::int AS n
      FROM kc WHERE kc.count_move_in IS TRUE AND kc.mi_date BETWEEN p_start AND p_end
     GROUP BY 1, 2
  ),
  mo AS (
    SELECT kc.cid, date_trunc('month', kc.mo_date)::date AS m, count(*)::int AS n
      FROM kc WHERE kc.count_move_out IS TRUE AND kc.mo_date BETWEEN p_start AND p_end
     GROUP BY 1, 2
  ),
  ga AS (
    SELECT f.mapped_community_id AS cid, date_trunc('month', f.date)::date AS m,
           SUM(f.sessions)::bigint AS ses, SUM(f.engaged_sessions)::bigint AS eng
      FROM public.ga4_api_facts f
     WHERE f.organization_id = _org_id
       AND f.mapped_community_id = ANY(scope)
       AND f.report = 'landing_page'
       AND f.date BETWEEN p_start AND p_end
       AND NOT COALESCE(f.is_partial_day, false)
     GROUP BY 1, 2
  ),
  fl AS (
    SELECT l.community_id AS cid,
           date_trunc('month', (l.created_on AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date)::date AS m,
           count(*)::bigint AS n
      FROM public.further_leads l
      JOIN comms c ON c.id = l.community_id
     WHERE l.organization_id = _org_id
       AND l.created_on BETWEEN t_lo AND t_hi
       AND ((l.created_on AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date) BETWEEN p_start AND p_end
     GROUP BY 1, 2
  ),
  occ_raw AS (
    SELECT x.*, date_trunc('month', x.d)::date AS m
      FROM public.wh_occupancy_history_daily(_org_id, scope, p_start, p_end) x
  ),
  occ AS (
    SELECT DISTINCT ON (o.community_id, o.m)
           o.community_id AS cid, o.m, o.occupied, o.census, o.src
      FROM occ_raw o
     ORDER BY o.community_id, o.m, o.d DESC
  )
  SELECT g.cid, g.cname, g.m,
         COALESCE(inq.n, 0), COALESCE(tr.n, 0), COALESCE(tr.rn, 0), COALESCE(dep.n, 0),
         COALESCE(mi.n, 0), COALESCE(mo.n, 0), COALESCE(mi.n, 0) - COALESCE(mo.n, 0),
         COALESCE(ga.ses, 0), COALESCE(ga.eng, 0), COALESCE(fl.n, 0),
         CASE WHEN occ.census IS NOT NULL AND occ.census > 0
              THEN round(occ.occupied / occ.census * 100, 1) END,
         round(occ.occupied)::int,
         round(occ.census)::int,
         occ.src
    FROM grid g
    LEFT JOIN inq ON inq.cid = g.cid AND inq.m = g.m
    LEFT JOIN tr  ON tr.cid  = g.cid AND tr.m  = g.m
    LEFT JOIN dep ON dep.cid = g.cid AND dep.m = g.m
    LEFT JOIN mi  ON mi.cid  = g.cid AND mi.m  = g.m
    LEFT JOIN mo  ON mo.cid  = g.cid AND mo.m  = g.m
    LEFT JOIN ga  ON ga.cid  = g.cid AND ga.m  = g.m
    LEFT JOIN fl  ON fl.cid  = g.cid AND fl.m  = g.m
    LEFT JOIN occ ON occ.cid = g.cid AND occ.m = g.m
   ORDER BY g.cname, g.m;
END;
$function$;