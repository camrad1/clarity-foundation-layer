
-- =====================================================================
-- Sales Intelligence standard reports: bounded server-side aggregates.
-- No KPI definition changes: move-in/move-out/inquiry predicates are
-- identical to wh_sales_trend / wh_sales_summary.
-- =====================================================================

-- 1) Occupancy history (snapshot-only history; never reconstructed) -----
CREATE OR REPLACE FUNCTION public.wh_occupancy_monthly_history(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  month date,
  beginning_occupied integer,
  beginning_census integer,
  beginning_pct numeric,
  ending_occupied integer,
  ending_census integer,
  ending_pct numeric,
  budget_pct numeric,
  move_ins integer,
  move_outs integer,
  net_move_ins integer,
  communities_in_scope integer
)
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
  snaps AS (
    SELECT sn.snapshot_date,
           count(*)::int AS n,
           sum(sn.occupied_units)::int AS occ,
           sum(sn.census_units)::int AS cen,
           sum(sn.budget_units)::numeric AS bud
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id
       AND sn.community_id = ANY(scope)
       AND COALESCE(sn.status, 'success') = 'success'
     GROUP BY sn.snapshot_date
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
         b.occ, b.cen,
         CASE WHEN b.cen > 0 THEN round(b.occ::numeric / b.cen, 4) END,
         e.occ, e.cen,
         CASE WHEN e.cen > 0 THEN round(e.occ::numeric / e.cen, 4) END,
         CASE WHEN e.cen > 0 AND e.bud IS NOT NULL THEN round(e.bud / e.cen, 4) END,
         (SELECT count(*)::int FROM kc
           WHERE kc.count_move_in IS TRUE
             AND date_trunc('month', kc.mi_date)::date = months.m),
         (SELECT count(*)::int FROM kc
           WHERE kc.count_move_out IS TRUE
             AND date_trunc('month', kc.mo_date)::date = months.m),
         (SELECT count(*)::int FROM kc
           WHERE kc.count_move_in IS TRUE
             AND date_trunc('month', kc.mi_date)::date = months.m)
         -
         (SELECT count(*)::int FROM kc
           WHERE kc.count_move_out IS TRUE
             AND date_trunc('month', kc.mo_date)::date = months.m),
         n_scope
    FROM months
    -- Beginning = the immutable snapshot dated the first day of the month.
    LEFT JOIN snaps b ON b.snapshot_date = months.m AND b.n = n_scope
    -- Ending = the immutable snapshot dated the last day of the month.
    LEFT JOIN snaps e
           ON e.snapshot_date = (months.m + interval '1 month - 1 day')::date
          AND e.n = n_scope
   ORDER BY months.m;
END;
$function$;

-- 2) Move-ins by lead source, monthly ----------------------------------
CREATE OR REPLACE FUNCTION public.wh_move_ins_by_lead_source_monthly(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(month date, lead_source_label text, move_ins integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
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

  SELECT COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  SELECT date_trunc('month', mi.mi_date)::date AS month,
         mi.label,
         count(*)::int
    FROM (
      SELECT (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                   THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
             COALESCE(
               NULLIF(btrim(pr.lead_source_label), ''),
               NULLIF(btrim(lk.label), ''),
               'Unknown'
             ) AS label
        FROM public.wh_housing_contracts hc
        LEFT JOIN public.wh_prospects pr
               ON pr.organization_id = hc.organization_id
              AND pr.source_id = hc.prospect_source_id
        LEFT JOIN public.wh_lookups lk
               ON lk.organization_id = hc.organization_id
              AND lk.lookup_type = 'lead_source'
              AND lk.source_id = pr.lead_source_id
       WHERE hc.organization_id = _org_id
         AND hc.community_id = ANY(scope)
         AND hc.lease_canceled_on IS NULL
         AND hc.count_move_in IS TRUE
    ) mi
   WHERE mi.mi_date BETWEEN p_start AND p_end
   GROUP BY 1, 2
   ORDER BY 1, 3 DESC;
END;
$function$;

-- 3) Move-out reasons ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.wh_move_out_reason_summary(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  month date,
  reason_label text,
  move_outs integer,
  los_days numeric,
  los_sample integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
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

  SELECT COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  SELECT date_trunc('month', mo.mo_date)::date,
         mo.label,
         count(*)::int,
         round(avg(mo.los) FILTER (WHERE mo.los IS NOT NULL), 0),
         count(mo.los)::int
    FROM (
      SELECT (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                   THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date,
             COALESCE(NULLIF(btrim(hc.move_out_reason_label), ''), 'Not recorded') AS label,
             NULLIF(
               (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                     THEN hc.financial_move_out_date ELSE hc.move_out_date END)
               - (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                       THEN hc.financial_move_in_date ELSE hc.move_in_date END),
               NULL
             )::numeric AS los
        FROM public.wh_housing_contracts hc
       WHERE hc.organization_id = _org_id
         AND hc.community_id = ANY(scope)
         AND hc.lease_canceled_on IS NULL
         AND hc.count_move_out IS TRUE
    ) mo
   WHERE mo.mo_date BETWEEN p_start AND p_end
   GROUP BY 1, 2
   ORDER BY 1, 3 DESC;
END;
$function$;

-- 4) New inquiries by month or week (validated wh.new_inquiries) --------
CREATE OR REPLACE FUNCTION public.wh_new_inquiries_monthly(
  _org_id uuid,
  _end date,
  _periods integer DEFAULT 12,
  _grain text DEFAULT 'month',
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(bucket date, inquiries integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  s record;
  p_start date;
  p_end date;
  g text;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  g := CASE WHEN lower(COALESCE(_grain, 'month')) = 'week' THEN 'week' ELSE 'month' END;
  _end := COALESCE(_end, current_date);

  IF g = 'week' THEN
    _periods := least(greatest(COALESCE(_periods, 13), 1), 53);
    p_end := (public.flash_week_start(_end) + 6);
    p_start := public.flash_week_start(_end) - ((_periods - 1) * 7);
  ELSE
    _periods := least(greatest(COALESCE(_periods, 12), 1), 36);
    p_start := (date_trunc('month', _end)::date - make_interval(months => _periods - 1))::date;
    p_end := (date_trunc('month', _end)::date + interval '1 month - 1 day')::date;
  END IF;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  WITH buckets AS (
    SELECT CASE WHEN g = 'week'
                THEN generate_series(p_start, p_end, interval '7 day')::date
                ELSE generate_series(p_start, date_trunc('month', p_end)::date, interval '1 month')::date
           END AS b
  ),
  pc AS (
    SELECT (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END
              AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS inq_local_date
      FROM public.wh_prospects pr
      LEFT JOIN public.communities c ON c.id = pr.community_id
     WHERE pr.organization_id = _org_id
       AND pr.community_id = ANY(scope)
       AND (NOT s.exclude_merged_prospects OR pr.merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR pr.discarded_at IS NULL)
  )
  SELECT buckets.b,
         (SELECT count(*)::int FROM pc
           WHERE CASE WHEN g = 'week'
                      THEN public.flash_week_start(pc.inq_local_date) = buckets.b
                      ELSE date_trunc('month', pc.inq_local_date)::date = buckets.b END)
    FROM buckets
   ORDER BY buckets.b;
END;
$function$;

-- 5) Lost leads by close reason ----------------------------------------
CREATE OR REPLACE FUNCTION public.wh_lost_lead_summary(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(month date, reason_label text, lost_leads integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
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

  SELECT COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  SELECT date_trunc('month', lost.closed_local_date)::date,
         lost.label,
         count(*)::int
    FROM (
      SELECT (pr.status_changed_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS closed_local_date,
             COALESCE(
               NULLIF(btrim(pr.close_reason_label), ''),
               NULLIF(btrim(lk.label), ''),
               'Not recorded'
             ) AS label
        FROM public.wh_prospects pr
        LEFT JOIN public.communities c ON c.id = pr.community_id
        LEFT JOIN public.wh_lookups lk
               ON lk.organization_id = pr.organization_id
              AND lk.lookup_type = 'close_reason'
              AND lk.source_id = pr.close_reason_id
       WHERE pr.organization_id = _org_id
         AND pr.community_id = ANY(scope)
         AND pr.status = 'closed'
         AND pr.close_reason_id IS NOT NULL
         AND pr.status_changed_at IS NOT NULL
         AND (NOT s.exclude_merged_prospects OR pr.merged_into_prospect_id IS NULL)
    ) lost
   WHERE lost.closed_local_date BETWEEN p_start AND p_end
   GROUP BY 1, 2
   ORDER BY 1, 3 DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.wh_occupancy_monthly_history(uuid, date, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_move_ins_by_lead_source_monthly(uuid, date, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_move_out_reason_summary(uuid, date, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_new_inquiries_monthly(uuid, date, integer, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_lost_lead_summary(uuid, date, integer, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.wh_occupancy_monthly_history(uuid, date, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_move_ins_by_lead_source_monthly(uuid, date, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_move_out_reason_summary(uuid, date, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_new_inquiries_monthly(uuid, date, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_lost_lead_summary(uuid, date, integer, uuid[]) TO authenticated;
