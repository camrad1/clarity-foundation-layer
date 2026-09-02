
REVOKE EXECUTE ON FUNCTION public.flash_note_audit() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.flash_week_start(_d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT _d - ((EXTRACT(dow FROM _d)::int + 2) % 7)
$$;

CREATE OR REPLACE FUNCTION public.wh_flash_scope(_org_id uuid, _community_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[];
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
  RETURN COALESCE(scope, ARRAY[]::uuid[]);
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_scope(uuid, uuid[]) FROM public, anon, authenticated;

-- Period-event metrics for one Flash period. Predicates are copied verbatim
-- from the validated wh_sales_summary KPIs; nothing is redefined here.
CREATE OR REPLACE FUNCTION public.wh_flash_period_metrics(_org_id uuid, _scope uuid[], _start date, _end date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  s record; tour_ids text[]; outreach_ids text[]; ok_ids text[];
  today date := current_date; res jsonb;
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
       AND ac.completed_local_date BETWEEN _start AND _end
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
    'inquiries', (SELECT count(*)::int FROM pc WHERE inq_local_date BETWEEN _start AND _end),
    'outreach', (SELECT count(*)::int FROM ap
                  WHERE outreach_ids IS NOT NULL AND activity_type_id = ANY(outreach_ids)),
    'tours', (SELECT count(*)::int FROM tours_ok),
    'reTours', (SELECT count(*)::int FROM tours_ok WHERE first_completed_of_type IS FALSE),
    'moveIns', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE AND mi_date BETWEEN _start AND _end),
    'moveOuts', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE AND mo_date BETWEEN _start AND _end),
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
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_period_metrics(uuid, uuid[], date, date) FROM public, anon, authenticated;

-- Current-state occupancy (no historical reconstruction: nightly snapshots
-- are not built yet, so only "as of today" is knowable).
CREATE OR REPLACE FUNCTION public.wh_flash_occupancy(_org_id uuid, _scope uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE pseudo_patterns text[]; today date := current_date; res jsonb;
BEGIN
  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY['WAITLIST']::text[]) INTO pseudo_patterns
    FROM (SELECT 1) dd LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  pseudo_patterns := COALESCE(pseudo_patterns, ARRAY['WAITLIST']::text[]);

  WITH u AS (
    SELECT un.source_id, COALESCE(NULLIF(btrim(un.care_type_label), ''), 'Unspecified') AS care_type,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           pseudo_patterns) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id AND un.community_id = ANY(_scope)
  ),
  ue AS (SELECT * FROM u WHERE exclusion_reason IS NULL),
  k AS (
    SELECT hc.unit_source_id, hc.count_move_in, hc.notice_date,
           COALESCE(hc.financial_move_in_date, hc.move_in_date) AS mi_date,
           COALESCE(hc.financial_move_out_date, hc.move_out_date) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(_scope)
  ),
  occ AS (
    SELECT DISTINCT k.unit_source_id FROM k
     WHERE k.unit_source_id IS NOT NULL
       AND k.unit_source_id IN (SELECT source_id FROM ue)
       AND k.count_move_in IS TRUE
       AND k.mi_date IS NOT NULL AND k.mi_date <= today
       AND (k.mo_date IS NULL OR k.mo_date > today)
  )
  SELECT jsonb_build_object(
    'asOf', today,
    'totalUnits', (SELECT count(*)::int FROM u),
    'excludedUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason IS NOT NULL),
    'pseudoUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'pseudo_unit'),
    'offCensusUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'off_census'),
    'inactiveUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'inactive'),
    'censusUnits', (SELECT count(*)::int FROM ue),
    'occupiedUnits', (SELECT count(*)::int FROM occ),
    'noticeCount', (SELECT count(*)::int FROM k WHERE notice_date IS NOT NULL
                      AND (mo_date IS NULL OR mo_date > today)),
    'byCareType', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'careType') FROM (
        SELECT jsonb_build_object(
                 'careType', ue.care_type,
                 'units', count(*)::int,
                 'occupied', count(*) FILTER (WHERE ue.source_id IN (SELECT unit_source_id FROM occ))::int) AS x
          FROM ue GROUP BY ue.care_type) q), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_occupancy(uuid, uuid[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.flash_budget_units(_org_id uuid, _scope uuid[], _as_of date)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'units', NULLIF(SUM(b.budget_occupied_units), 0)::int,
    'pct', AVG(b.budget_occupancy_pct),
    'communities', count(*)::int)
  FROM LATERAL (
    SELECT DISTINCT ON (fb.community_id) fb.*
      FROM public.flash_occupancy_budgets fb
     WHERE fb.organization_id = _org_id
       AND fb.community_id = ANY(_scope)
       AND fb.effective_start <= _as_of
       AND (fb.effective_end IS NULL OR fb.effective_end >= _as_of)
     ORDER BY fb.community_id, fb.effective_start DESC
  ) b
$$;
REVOKE EXECUTE ON FUNCTION public.flash_budget_units(uuid, uuid[], date) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wh_flash_report(
  _org_id uuid, _start date, _end date, _month date, _community_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  scope uuid[];
  today date := current_date;
  m_start date := date_trunc('month', _month)::date;
  m_end date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  nm_start date := (date_trunc('month', _month) + interval '1 month')::date;
  nm_end date := (date_trunc('month', _month) + interval '2 month - 1 day')::date;
  ws date; we date; idx int := 0;
  weeks jsonb := '[]'::jsonb;
  occ jsonb;
  row_json jsonb;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);

  ws := public.flash_week_start(m_start);
  LOOP
    we := ws + 6;
    EXIT WHEN we > m_end + 6;
    IF we >= m_start AND we <= m_end THEN
      idx := idx + 1;
      row_json := public.wh_flash_period_metrics(_org_id, scope, ws, we)
        || jsonb_build_object(
             'label', 'WK ' || idx,
             'isCurrent', (today BETWEEN ws AND we),
             'budget', public.flash_budget_units(_org_id, scope, we),
             'occupancy', CASE WHEN today BETWEEN ws AND we THEN occ ELSE NULL END);
      weeks := weeks || jsonb_build_array(row_json);
    END IF;
    ws := ws + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'week', public.wh_flash_period_metrics(_org_id, scope, _start, _end)
              || jsonb_build_object('label', 'Selected Flash week',
                                    'isCurrent', (today BETWEEN _start AND _end),
                                    'budget', public.flash_budget_units(_org_id, scope, _end)),
    'month', public.wh_flash_period_metrics(_org_id, scope, m_start, m_end)
              || jsonb_build_object('label', 'MONTH END',
                                    'budget', public.flash_budget_units(_org_id, scope, m_end),
                                    'occupancy', CASE WHEN today BETWEEN m_start AND m_end THEN occ ELSE NULL END),
    'nextMonth', public.wh_flash_period_metrics(_org_id, scope, nm_start, nm_end)
              || jsonb_build_object('label', 'Next month'),
    'weeks', weeks,
    'occupancy', occ,
    'budget', public.flash_budget_units(_org_id, scope, today),
    'monthStart', m_start,
    'monthEnd', m_end,
    'communities', COALESCE(array_length(scope, 1), 0),
    'generatedAt', now()
  );
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_report(uuid, date, date, date, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_report(uuid, date, date, date, uuid[]) TO authenticated;
