CREATE OR REPLACE FUNCTION public.wh_sales_trend(
  _org_id uuid,
  _end date,
  _months integer DEFAULT 12,
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  month date,
  inquiries integer,
  tours integer,
  re_tours integer,
  deposits integer,
  move_ins integer,
  move_outs integer,
  net_move_ins integer
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

  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings
   WHERE organization_id = _org_id AND category = 'tour';
  ok_ids := public.wh_successful_result_ids(_org_id);

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(p_start, date_trunc('month', p_end)::date, interval '1 month')::date AS m
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
  ),
  tours_ok AS (
    SELECT ac.completed_local_date, ac.first_completed_of_type
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND ac.community_id = ANY(scope)
       AND ac.discarded_at IS NULL
       AND ac.completed_at IS NOT NULL
       AND tour_ids IS NOT NULL
       AND ac.activity_type_id = ANY(tour_ids)
       AND ac.result_id IS NOT NULL
       AND ac.result_id = ANY(ok_ids)
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
  ),
  depositors AS (
    SELECT DISTINCT date_trunc('month', dt.occurred_local_date)::date AS m,
           dt.community_id,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id
       AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit'
       AND dt.deposit_type = 'Deposit'
       AND COALESCE(dt.amount, 0) > 0
       AND dt.occurred_local_date BETWEEN p_start AND p_end
  )
  SELECT months.m,
         (SELECT count(*)::int FROM pc
           WHERE date_trunc('month', pc.inq_local_date)::date = months.m),
         (SELECT count(*)::int FROM tours_ok
           WHERE date_trunc('month', tours_ok.completed_local_date)::date = months.m),
         (SELECT count(*)::int FROM tours_ok
           WHERE date_trunc('month', tours_ok.completed_local_date)::date = months.m
             AND tours_ok.first_completed_of_type IS FALSE),
         (SELECT count(*)::int FROM depositors WHERE depositors.m = months.m),
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
             AND date_trunc('month', kc.mo_date)::date = months.m)
    FROM months
   ORDER BY months.m;
END;
$function$;

REVOKE ALL ON FUNCTION public.wh_sales_trend(uuid, date, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_sales_trend(uuid, date, integer, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.wh_activity_mix(
  _org_id uuid,
  _start date,
  _end date,
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(category text, activities integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  RETURN QUERY
  SELECT COALESCE(m.category::text, 'unmapped') AS category,
         count(*)::int AS activities
    FROM public.wh_activities ac
    LEFT JOIN public.wh_activity_type_mappings m
      ON m.organization_id = _org_id
     AND m.activity_type_id = ac.activity_type_id
   WHERE ac.organization_id = _org_id
     AND ac.community_id = ANY(scope)
     AND ac.discarded_at IS NULL
     AND ac.completed_at IS NOT NULL
     AND ac.completed_local_date BETWEEN _start AND _end
   GROUP BY 1
   ORDER BY 2 DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.wh_activity_mix(uuid, date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_activity_mix(uuid, date, date, uuid[]) TO authenticated;