CREATE OR REPLACE FUNCTION public.wh_flash_period_metrics(_org_id uuid, _scope uuid[], _start date, _end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; tour_ids text[]; outreach_ids text[]; ok_ids text[];
  today date := current_date; res jsonb;
  -- Actual completed-event metrics never extend past today; pending metrics
  -- still look ahead to _end.
  act_end date := LEAST(_end, today);
BEGIN
  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings WHERE organization_id = _org_id AND category = 'tour';
  SELECT array_agg(activity_type_id) INTO outreach_ids
    FROM public.wh_activity_type_mappings WHERE organization_id = _org_id AND category = 'outreach';
  ok_ids := public.wh_successful_result_ids(_org_id);

  WITH p AS (
    SELECT pr.source_id, pr.merged_into_prospect_id, pr.discarded_at,
           (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END
              AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS inq_local_date
      FROM public.wh_prospects pr
      LEFT JOIN public.communities c ON c.id = pr.community_id
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(_scope)
  ),
  pc AS (
    SELECT * FROM p
     WHERE (NOT s.exclude_merged_prospects OR merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR discarded_at IS NULL)
  ),
  ap AS (
    SELECT ac.activity_type_id, ac.first_completed_of_type,
           (ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)) AS ok
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id AND ac.community_id = ANY(_scope)
       AND ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
       AND ac.completed_local_date BETWEEN _start AND act_end
  ),
  tours_ok AS (
    SELECT * FROM ap WHERE ok AND tour_ids IS NOT NULL AND activity_type_id = ANY(tour_ids)
  ),
  k AS (
    SELECT hc.count_move_in, hc.count_move_out,
           (hc.lease_canceled_on IS NOT NULL) AS canceled,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(_scope)
  ),
  kc AS (SELECT * FROM k WHERE NOT canceled)
  SELECT jsonb_build_object(
    'start', _start,
    'end', _end,
    'inquiries', (SELECT count(*)::int FROM pc WHERE inq_local_date BETWEEN _start AND act_end),
    'outreach', (SELECT count(*)::int FROM ap
                  WHERE outreach_ids IS NOT NULL AND activity_type_id = ANY(outreach_ids)),
    'tours', (SELECT count(*)::int FROM tours_ok),
    'reTours', (SELECT count(*)::int FROM tours_ok WHERE first_completed_of_type IS FALSE),
    'moveIns', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE AND mi_date BETWEEN _start AND act_end),
    'moveOuts', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE AND mo_date BETWEEN _start AND act_end),
    'pendingIn', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE
                    AND mi_date BETWEEN greatest(_start, today + 1) AND _end),
    'pendingOut', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE
                    AND mo_date BETWEEN greatest(_start, today + 1) AND _end),
    'outreachMapped', COALESCE(array_length(outreach_ids, 1), 0) > 0
  ) INTO res;

  res := res || jsonb_build_object(
    'net', (res->>'moveIns')::int - (res->>'moveOuts')::int,
    'pendingNet', (res->>'pendingIn')::int - (res->>'pendingOut')::int);
  RETURN res;
END; $function$;