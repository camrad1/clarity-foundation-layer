-- ============ Shared historical occupancy resolver ============
CREATE OR REPLACE FUNCTION public.wh_occupancy_history_daily(
  _org_id uuid, _scope uuid[], _start date, _end date)
RETURNS TABLE(community_id uuid, d date, src text, census numeric, occupied numeric,
              beginning_occupied numeric, vacant numeric, notice numeric,
              reserved numeric, budget numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH snaps AS (
    SELECT sn.community_id, sn.snapshot_date AS d, 'snapshot'::text AS src,
           sn.census_units::numeric, sn.occupied_units::numeric,
           sn.occupied_units::numeric AS beginning_occupied,
           sn.vacant_units::numeric, sn.notice_count::numeric,
           sn.reserved_count::numeric, sn.budget_units::numeric
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id
       AND sn.community_id = ANY(_scope)
       AND COALESCE(sn.status,'success') = 'success'
       AND (_start IS NULL OR sn.snapshot_date >= _start)
       AND (_end IS NULL OR sn.snapshot_date <= _end)
  )
  SELECT * FROM snaps
  UNION ALL
  SELECT h.community_id, h.occupancy_date, 'official_backfill'::text,
         h.total_units, h.ending_occupied_units,
         COALESCE(h.beginning_occupied_units, h.ending_occupied_units),
         CASE WHEN h.total_units IS NOT NULL
              THEN h.total_units - h.ending_occupied_units END,
         NULL::numeric, NULL::numeric,
         (SELECT fb.budget_occupied_units::numeric
            FROM public.flash_occupancy_budgets fb
           WHERE fb.organization_id = _org_id AND fb.community_id = h.community_id
             AND fb.effective_start <= h.occupancy_date
             AND (fb.effective_end IS NULL OR fb.effective_end >= h.occupancy_date)
           ORDER BY fb.effective_start DESC LIMIT 1)
    FROM public.community_daily_occupancy_history h
   WHERE h.organization_id = _org_id
     AND h.community_id = ANY(_scope)
     AND h.source_type = 'official_daily_backfill'
     AND h.ending_occupied_units IS NOT NULL
     AND (_start IS NULL OR h.occupancy_date >= _start)
     AND (_end IS NULL OR h.occupancy_date <= _end)
     AND NOT EXISTS (SELECT 1 FROM snaps s
                      WHERE s.community_id = h.community_id AND s.d = h.occupancy_date);
$function$;

REVOKE ALL ON FUNCTION public.wh_occupancy_history_daily(uuid, uuid[], date, date) FROM PUBLIC, anon, authenticated;

-- ============ Trend (daily / weekly / monthly) ============
CREATE OR REPLACE FUNCTION public.wh_occupancy_trend(
  _org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[], _start date DEFAULT NULL::date,
  _end date DEFAULT NULL::date, _grain text DEFAULT 'daily'::text)
RETURNS TABLE(period_start date, snapshot_date date, communities integer, census_units integer,
              occupied_units integer, vacant_units integer, notice_count integer,
              reserved_count integer, occupancy_pct numeric, budget_units integer,
              budget_pct numeric, variance_units integer, snapshot_communities integer,
              backfill_communities integer, beginning_occupied integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; g text := lower(COALESCE(_grain, 'daily'));
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope,1),0) = 0 THEN RETURN; END IF;
  IF g NOT IN ('daily','weekly','monthly') THEN g := 'daily'; END IF;

  RETURN QUERY
  WITH r AS (
    SELECT x.*, CASE g
             WHEN 'weekly' THEN greatest(public.flash_week_start(x.d), COALESCE(_start, public.flash_week_start(x.d)))
             WHEN 'monthly' THEN greatest(date_trunc('month', x.d)::date, COALESCE(_start, date_trunc('month', x.d)::date))
             ELSE x.d END AS pstart
      FROM public.wh_occupancy_history_daily(_org_id, scope, _start, _end) x
  ),
  last_per_community AS (
    SELECT DISTINCT ON (r.pstart, r.community_id) r.* FROM r
     ORDER BY r.pstart, r.community_id, r.d DESC
  ),
  first_per_community AS (
    SELECT DISTINCT ON (r.pstart, r.community_id) r.pstart, r.community_id, r.beginning_occupied
      FROM r ORDER BY r.pstart, r.community_id, r.d ASC
  ),
  firsts AS (
    SELECT f.pstart, round(sum(f.beginning_occupied))::int AS beg
      FROM first_per_community f GROUP BY f.pstart
  )
  SELECT l.pstart,
         max(l.d),
         count(*)::int,
         round(COALESCE(sum(l.census),0))::int,
         round(COALESCE(sum(l.occupied),0))::int,
         round(COALESCE(sum(l.vacant),0))::int,
         round(COALESCE(sum(l.notice),0))::int,
         round(COALESCE(sum(l.reserved),0))::int,
         CASE WHEN COALESCE(sum(l.census),0) = 0 THEN NULL
              ELSE round(sum(l.occupied)::numeric / sum(l.census)::numeric, 6) END,
         NULLIF(round(COALESCE(sum(l.budget),0)),0)::int,
         CASE WHEN COALESCE(sum(l.census),0) = 0 OR COALESCE(sum(l.budget),0) = 0 THEN NULL
              ELSE round(sum(l.budget)::numeric * 100 / sum(l.census)::numeric, 2) END,
         CASE WHEN COALESCE(sum(l.budget),0) = 0 THEN NULL
              ELSE round(sum(l.occupied) - sum(l.budget))::int END,
         count(*) FILTER (WHERE l.src = 'snapshot')::int,
         count(*) FILTER (WHERE l.src = 'official_backfill')::int,
         (SELECT f.beg FROM firsts f WHERE f.pstart = l.pstart)
    FROM last_per_community l
   GROUP BY l.pstart
   ORDER BY l.pstart;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) TO authenticated;

-- ============ Monthly history, driven by the selected date range ============
DROP FUNCTION IF EXISTS public.wh_occupancy_monthly_history(uuid, date, integer, uuid[]);

CREATE OR REPLACE FUNCTION public.wh_occupancy_monthly_history(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(month date, period_start date, period_end date,
              beginning_occupied integer, beginning_census integer, beginning_pct numeric,
              ending_occupied integer, ending_census integer, ending_pct numeric,
              budget_pct numeric, move_ins integer, move_outs integer, net_move_ins integer,
              communities_in_scope integer, communities_with_history integer,
              snapshot_communities integer, backfill_communities integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; n_scope integer; s record;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  n_scope := COALESCE(array_length(scope,1),0);
  IF n_scope = 0 THEN RETURN; END IF;

  _end := COALESCE(_end, current_date);
  _start := COALESCE(_start, (date_trunc('month', _end)::date - interval '11 months')::date);
  IF _start > _end THEN RETURN; END IF;

  SELECT COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  WITH months AS (
    SELECT gs::date AS m,
           greatest(gs::date, _start) AS gstart,
           least((gs + interval '1 month - 1 day')::date, _end) AS gend
      FROM generate_series(date_trunc('month', _start), date_trunc('month', _end), interval '1 month') gs
  ),
  r AS (
    SELECT x.*, date_trunc('month', x.d)::date AS m
      FROM public.wh_occupancy_history_daily(_org_id, scope, _start, _end) x
  ),
  last_rec AS (
    SELECT DISTINCT ON (r.m, r.community_id) r.* FROM r ORDER BY r.m, r.community_id, r.d DESC
  ),
  first_rec AS (
    SELECT DISTINCT ON (r.m, r.community_id) r.* FROM r ORDER BY r.m, r.community_id, r.d ASC
  ),
  ends AS (
    SELECT l.m, count(*)::int AS n, sum(l.occupied) AS occ, sum(l.census) AS cen,
           count(l.census) AS cen_n, sum(l.budget) AS bud,
           count(*) FILTER (WHERE l.src = 'snapshot')::int AS snap_n,
           count(*) FILTER (WHERE l.src = 'official_backfill')::int AS back_n
      FROM last_rec l GROUP BY l.m
  ),
  begs AS (
    SELECT f.m, count(*)::int AS n, sum(f.beginning_occupied) AS occ,
           sum(f.census) AS cen, count(f.census) AS cen_n
      FROM first_rec f GROUP BY f.m
  ),
  kc AS (
    SELECT (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date,
           hc.count_move_in, hc.count_move_out
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  )
  SELECT months.m, months.gstart, months.gend,
         round(b.occ)::int,
         CASE WHEN b.cen_n = b.n THEN round(b.cen)::int END,
         CASE WHEN b.cen_n = b.n AND b.cen > 0 THEN round(b.occ / b.cen, 4) END,
         round(e.occ)::int,
         CASE WHEN e.cen_n = e.n THEN round(e.cen)::int END,
         CASE WHEN e.cen_n = e.n AND e.cen > 0 THEN round(e.occ / e.cen, 4) END,
         CASE WHEN e.cen_n = e.n AND e.cen > 0 AND e.bud IS NOT NULL THEN round(e.bud / e.cen, 4) END,
         (SELECT count(*)::int FROM kc WHERE kc.count_move_in IS TRUE
            AND kc.mi_date BETWEEN months.gstart AND months.gend),
         (SELECT count(*)::int FROM kc WHERE kc.count_move_out IS TRUE
            AND kc.mo_date BETWEEN months.gstart AND months.gend),
         (SELECT count(*)::int FROM kc WHERE kc.count_move_in IS TRUE
            AND kc.mi_date BETWEEN months.gstart AND months.gend)
         -
         (SELECT count(*)::int FROM kc WHERE kc.count_move_out IS TRUE
            AND kc.mo_date BETWEEN months.gstart AND months.gend),
         n_scope,
         COALESCE(e.n, 0),
         COALESCE(e.snap_n, 0),
         COALESCE(e.back_n, 0)
    FROM months
    LEFT JOIN begs b ON b.m = months.m
    LEFT JOIN ends e ON e.m = months.m
   ORDER BY months.m;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_occupancy_monthly_history(uuid, date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_monthly_history(uuid, date, date, uuid[]) TO authenticated;