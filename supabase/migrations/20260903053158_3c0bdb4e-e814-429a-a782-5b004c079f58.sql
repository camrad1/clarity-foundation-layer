-- 1. As-of resolver: snapshot first, official backfill only where no snapshot exists.
CREATE OR REPLACE FUNCTION public.wh_snapshot_asof(_org_id uuid, _scope uuid[], _date date, _tolerance integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF _scope IS NULL OR COALESCE(array_length(_scope,1),0) = 0 THEN RETURN NULL; END IF;

  WITH snap AS (
    SELECT DISTINCT ON (s.community_id) s.*
      FROM public.community_daily_snapshots s
     WHERE s.organization_id = _org_id
       AND s.community_id = ANY(_scope)
       AND s.status = 'success'
       AND s.snapshot_date <= _date
       AND s.snapshot_date >= _date - GREATEST(_tolerance, 0)
     ORDER BY s.community_id, s.snapshot_date DESC
  ),
  back AS (
    SELECT DISTINCT ON (h.community_id) h.*
      FROM public.community_daily_occupancy_history h
     WHERE h.organization_id = _org_id
       AND h.community_id = ANY(_scope)
       AND h.source_type = 'official_daily_backfill'
       AND h.occupancy_date <= _date
       AND h.occupancy_date >= _date - GREATEST(_tolerance, 0)
       AND NOT EXISTS (SELECT 1 FROM snap sp WHERE sp.community_id = h.community_id)
     ORDER BY h.community_id, h.occupancy_date DESC
  ),
  latest AS (
    SELECT s.id, s.community_id, s.snapshot_date AS as_of_date, 'snapshot'::text AS src,
           s.total_unit_records::numeric AS total_unit_records, s.census_units::numeric AS census_units,
           s.occupied_units::numeric AS occupied_units, s.vacant_units::numeric AS vacant_units,
           s.notice_count::numeric AS notice_count, s.reserved_count::numeric AS reserved_count,
           s.off_census_units::numeric AS off_census_units, s.pseudo_units::numeric AS pseudo_units,
           s.inactive_units::numeric AS inactive_units, s.budget_units::numeric AS budget_units
      FROM snap s
    UNION ALL
    SELECT NULL::uuid, b.community_id, b.occupancy_date, 'official_backfill'::text,
           b.total_units, b.total_units, b.ending_occupied_units,
           CASE WHEN b.total_units IS NOT NULL THEN b.total_units - b.ending_occupied_units END,
           NULL, NULL, NULL, NULL, NULL,
           (SELECT fb.budget_occupied_units::numeric
              FROM public.flash_occupancy_budgets fb
             WHERE fb.organization_id = _org_id AND fb.community_id = b.community_id
               AND fb.effective_start <= b.occupancy_date
               AND (fb.effective_end IS NULL OR fb.effective_end >= b.occupancy_date)
             ORDER BY fb.effective_start DESC LIMIT 1)
      FROM back b
  ),
  ct AS (
    SELECT t.care_type_label,
           SUM(t.census_units)::int AS units,
           SUM(t.occupied_units)::int AS occupied
      FROM public.community_daily_snapshot_care_types t
      JOIN latest l ON l.id = t.snapshot_id
     GROUP BY t.care_type_label
  )
  SELECT CASE WHEN (SELECT count(*) FROM latest) = 0 THEN NULL ELSE jsonb_build_object(
    'source', CASE
      WHEN (SELECT count(*) FROM latest WHERE src = 'official_backfill') = 0 THEN 'snapshot'
      WHEN (SELECT count(*) FROM latest WHERE src = 'snapshot') = 0 THEN 'official_backfill'
      ELSE 'mixed' END,
    'snapshotCommunities', (SELECT count(*)::int FROM latest WHERE src = 'snapshot'),
    'backfillCommunities', (SELECT count(*)::int FROM latest WHERE src = 'official_backfill'),
    'asOf', _date,
    'snapshotDate', (SELECT max(as_of_date) FROM latest),
    'oldestSnapshotDate', (SELECT min(as_of_date) FROM latest),
    'communitiesCovered', (SELECT count(*)::int FROM latest),
    'communitiesRequested', COALESCE(array_length(_scope,1), 0),
    'complete', (SELECT count(*) FROM latest) = COALESCE(array_length(_scope,1), 0),
    'totalUnits', (SELECT COALESCE(sum(total_unit_records),0)::int FROM latest),
    'censusUnits', (SELECT COALESCE(sum(census_units),0)::int FROM latest),
    'occupiedUnits', (SELECT round(COALESCE(sum(occupied_units),0))::int FROM latest),
    'vacantUnits', (SELECT round(COALESCE(sum(vacant_units),0))::int FROM latest),
    'noticeCount', (SELECT COALESCE(sum(notice_count),0)::int FROM latest),
    'reservedUnits', (SELECT COALESCE(sum(reserved_count),0)::int FROM latest),
    'offCensusUnits', (SELECT COALESCE(sum(off_census_units),0)::int FROM latest),
    'pseudoUnits', (SELECT COALESCE(sum(pseudo_units),0)::int FROM latest),
    'inactiveUnits', (SELECT COALESCE(sum(inactive_units),0)::int FROM latest),
    'excludedUnits', (SELECT COALESCE(sum(COALESCE(off_census_units,0) + COALESCE(pseudo_units,0) + COALESCE(inactive_units,0)),0)::int FROM latest),
    'budgetUnits', (SELECT NULLIF(round(COALESCE(sum(budget_units),0)),0)::int FROM latest),
    'occupancyPct', (SELECT CASE WHEN COALESCE(sum(census_units),0) = 0 THEN NULL
                          ELSE round(sum(occupied_units)::numeric / sum(census_units)::numeric, 6) END FROM latest),
    'byCareType', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'careType', care_type_label, 'units', units, 'occupied', occupied) ORDER BY care_type_label) FROM ct), '[]'::jsonb)
  ) END INTO res;

  RETURN res;
END; $function$;

-- 2. Trend: union snapshots with official backfill days that have no snapshot.
DROP FUNCTION IF EXISTS public.wh_occupancy_trend(uuid, uuid[], date, date, text);
CREATE FUNCTION public.wh_occupancy_trend(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[], _start date DEFAULT NULL::date, _end date DEFAULT NULL::date, _grain text DEFAULT 'daily'::text)
 RETURNS TABLE(period_start date, snapshot_date date, communities integer, census_units integer, occupied_units integer, vacant_units integer, notice_count integer, reserved_count integer, occupancy_pct numeric, budget_units integer, budget_pct numeric, variance_units integer, snapshot_communities integer, backfill_communities integer, beginning_occupied integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; g text := lower(COALESCE(_grain, 'daily'));
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope,1),0) = 0 THEN RETURN; END IF;
  IF g NOT IN ('daily','weekly','monthly') THEN g := 'daily'; END IF;

  RETURN QUERY
  WITH snaps AS (
    SELECT sn.community_id, sn.snapshot_date AS d, 'snapshot'::text AS src,
           sn.census_units::numeric AS census_units, sn.occupied_units::numeric AS occupied_units,
           sn.vacant_units::numeric AS vacant_units, sn.notice_count::numeric AS notice_count,
           sn.reserved_count::numeric AS reserved_count, sn.budget_units::numeric AS budget_units,
           sn.occupied_units::numeric AS beginning_occupied
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id
       AND sn.community_id = ANY(scope)
       AND sn.status = 'success'
       AND (_start IS NULL OR sn.snapshot_date >= _start)
       AND (_end IS NULL OR sn.snapshot_date <= _end)
  ),
  backs AS (
    SELECT h.community_id, h.occupancy_date AS d, 'official_backfill'::text AS src,
           h.total_units AS census_units, h.ending_occupied_units AS occupied_units,
           CASE WHEN h.total_units IS NOT NULL THEN h.total_units - h.ending_occupied_units END AS vacant_units,
           NULL::numeric, NULL::numeric,
           (SELECT fb.budget_occupied_units::numeric
              FROM public.flash_occupancy_budgets fb
             WHERE fb.organization_id = _org_id AND fb.community_id = h.community_id
               AND fb.effective_start <= h.occupancy_date
               AND (fb.effective_end IS NULL OR fb.effective_end >= h.occupancy_date)
             ORDER BY fb.effective_start DESC LIMIT 1),
           h.beginning_occupied_units
      FROM public.community_daily_occupancy_history h
     WHERE h.organization_id = _org_id
       AND h.community_id = ANY(scope)
       AND h.source_type = 'official_daily_backfill'
       AND (_start IS NULL OR h.occupancy_date >= _start)
       AND (_end IS NULL OR h.occupancy_date <= _end)
       AND NOT EXISTS (SELECT 1 FROM snaps s WHERE s.community_id = h.community_id AND s.d = h.occupancy_date)
  ),
  s AS (
    SELECT u.*, CASE g
             WHEN 'weekly' THEN public.flash_week_start(u.d)
             WHEN 'monthly' THEN date_trunc('month', u.d)::date
             ELSE u.d END AS pstart
      FROM (SELECT * FROM snaps UNION ALL SELECT * FROM backs) u
  ),
  last_per_community AS (
    SELECT DISTINCT ON (s.pstart, s.community_id) s.*
      FROM s ORDER BY s.pstart, s.community_id, s.d DESC
  ),
  first_per_community AS (
    SELECT DISTINCT ON (s.pstart, s.community_id) s.pstart, s.community_id, s.beginning_occupied
      FROM s ORDER BY s.pstart, s.community_id, s.d ASC
  ),
  firsts AS (
    SELECT f.pstart, round(sum(f.beginning_occupied))::int AS beg
      FROM first_per_community f GROUP BY f.pstart
  )
  SELECT l.pstart,
         max(l.d),
         count(*)::int,
         round(COALESCE(sum(l.census_units),0))::int,
         round(COALESCE(sum(l.occupied_units),0))::int,
         round(COALESCE(sum(l.vacant_units),0))::int,
         round(COALESCE(sum(l.notice_count),0))::int,
         round(COALESCE(sum(l.reserved_count),0))::int,
         CASE WHEN COALESCE(sum(l.census_units),0) = 0 THEN NULL
              ELSE round(sum(l.occupied_units)::numeric / sum(l.census_units)::numeric, 6) END,
         NULLIF(round(COALESCE(sum(l.budget_units),0)),0)::int,
         CASE WHEN COALESCE(sum(l.census_units),0) = 0 OR COALESCE(sum(l.budget_units),0) = 0 THEN NULL
              ELSE round(sum(l.budget_units)::numeric * 100 / sum(l.census_units)::numeric, 2) END,
         CASE WHEN COALESCE(sum(l.budget_units),0) = 0 THEN NULL
              ELSE round(sum(l.occupied_units) - sum(l.budget_units))::int END,
         count(*) FILTER (WHERE l.src = 'snapshot')::int,
         count(*) FILTER (WHERE l.src = 'official_backfill')::int,
         (SELECT beg FROM firsts f WHERE f.pstart = l.pstart)
    FROM last_per_community l
   GROUP BY l.pstart
   ORDER BY l.pstart;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) TO authenticated;

-- 3. Monthly history: last/first available record per community in each month,
--    snapshot preferred over official backfill on the same date.
CREATE OR REPLACE FUNCTION public.wh_occupancy_monthly_history(_org_id uuid, _end date, _months integer DEFAULT 12, _community_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(month date, beginning_occupied integer, beginning_census integer, beginning_pct numeric, ending_occupied integer, ending_census integer, ending_pct numeric, budget_pct numeric, move_ins integer, move_outs integer, net_move_ins integer, communities_in_scope integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  n_scope integer;
  s record;
  p_start date;
  p_end date;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  _months := least(greatest(COALESCE(_months, 12), 1), 36);
  _end := COALESCE(_end, current_date);
  p_start := (date_trunc('month', _end)::date - make_interval(months => _months - 1))::date;
  p_end := (date_trunc('month', _end)::date + interval '1 month - 1 day')::date;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);
  n_scope := COALESCE(array_length(scope, 1), 0);

  SELECT COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(p_start, date_trunc('month', p_end)::date, interval '1 month')::date AS m
  ),
  daily AS (
    SELECT sn.community_id, sn.snapshot_date AS d,
           sn.occupied_units::numeric AS ending_occupied,
           sn.occupied_units::numeric AS beginning_occupied,
           sn.census_units::numeric AS census,
           sn.budget_units::numeric AS budget
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id AND sn.community_id = ANY(scope)
       AND COALESCE(sn.status,'success') = 'success'
       AND sn.snapshot_date BETWEEN p_start AND p_end
    UNION ALL
    SELECT h.community_id, h.occupancy_date,
           h.ending_occupied_units, h.beginning_occupied_units, h.total_units,
           (SELECT fb.budget_occupied_units::numeric
              FROM public.flash_occupancy_budgets fb
             WHERE fb.organization_id = _org_id AND fb.community_id = h.community_id
               AND fb.effective_start <= h.occupancy_date
               AND (fb.effective_end IS NULL OR fb.effective_end >= h.occupancy_date)
             ORDER BY fb.effective_start DESC LIMIT 1)
      FROM public.community_daily_occupancy_history h
     WHERE h.organization_id = _org_id AND h.community_id = ANY(scope)
       AND h.source_type = 'official_daily_backfill'
       AND h.occupancy_date BETWEEN p_start AND p_end
       AND NOT EXISTS (
         SELECT 1 FROM public.community_daily_snapshots sn2
          WHERE sn2.organization_id = _org_id AND sn2.community_id = h.community_id
            AND sn2.snapshot_date = h.occupancy_date AND COALESCE(sn2.status,'success') = 'success')
  ),
  tagged AS (SELECT d.*, date_trunc('month', d.d)::date AS m FROM daily d),
  last_rec AS (
    SELECT DISTINCT ON (t.m, t.community_id) t.* FROM tagged t
     ORDER BY t.m, t.community_id, t.d DESC
  ),
  first_rec AS (
    SELECT DISTINCT ON (t.m, t.community_id) t.* FROM tagged t
     ORDER BY t.m, t.community_id, t.d ASC
  ),
  ends AS (
    SELECT m, count(*)::int AS n, sum(ending_occupied) AS occ, sum(census) AS cen,
           sum(budget) AS bud, count(census) AS cen_n
      FROM last_rec GROUP BY m
  ),
  begs AS (
    SELECT m, count(*)::int AS n, sum(beginning_occupied) AS occ, sum(census) AS cen,
           count(census) AS cen_n
      FROM first_rec GROUP BY m
  ),
  kc AS (
    SELECT hc.count_move_in, hc.count_move_out,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  )
  SELECT months.m,
         round(b.occ)::int,
         CASE WHEN b.cen_n = b.n THEN round(b.cen)::int END,
         CASE WHEN b.cen_n = b.n AND b.cen > 0 THEN round(b.occ / b.cen, 4) END,
         round(e.occ)::int,
         CASE WHEN e.cen_n = e.n THEN round(e.cen)::int END,
         CASE WHEN e.cen_n = e.n AND e.cen > 0 THEN round(e.occ / e.cen, 4) END,
         CASE WHEN e.cen_n = e.n AND e.cen > 0 AND e.bud IS NOT NULL THEN round(e.bud / e.cen, 4) END,
         (SELECT count(*)::int FROM kc WHERE kc.count_move_in IS TRUE AND date_trunc('month', kc.mi_date)::date = months.m),
         (SELECT count(*)::int FROM kc WHERE kc.count_move_out IS TRUE AND date_trunc('month', kc.mo_date)::date = months.m),
         (SELECT count(*)::int FROM kc WHERE kc.count_move_in IS TRUE AND date_trunc('month', kc.mi_date)::date = months.m)
         -
         (SELECT count(*)::int FROM kc WHERE kc.count_move_out IS TRUE AND date_trunc('month', kc.mo_date)::date = months.m),
         n_scope
    FROM months
    LEFT JOIN begs b ON b.m = months.m AND b.n = n_scope
    LEFT JOIN ends e ON e.m = months.m AND e.n = n_scope
   ORDER BY months.m;
END;
$function$;

-- 4. Occupancy history health per community.
CREATE OR REPLACE FUNCTION public.occ_history_health(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(community_id uuid, community_name text, source_type text, first_date date, last_date date, record_count integer, missing_days integer, warning_count integer, last_import_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope,1),0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, c.name, 'official_daily_backfill'::text,
         min(h.occupancy_date), max(h.occupancy_date), count(h.id)::int,
         CASE WHEN count(h.id) = 0 THEN 0
              ELSE ((max(h.occupancy_date) - min(h.occupancy_date) + 1) - count(h.id))::int END,
         count(h.id) FILTER (WHERE h.validation_status <> 'ok')::int,
         max(h.imported_at)
    FROM public.communities c
    LEFT JOIN public.community_daily_occupancy_history h
      ON h.community_id = c.id AND h.organization_id = _org_id
     AND h.source_type = 'official_daily_backfill'
   WHERE c.id = ANY(scope)
   GROUP BY c.id, c.name
   ORDER BY c.name;
END; $function$;

REVOKE ALL ON FUNCTION public.occ_history_health(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.occ_history_health(uuid, uuid[]) TO authenticated;