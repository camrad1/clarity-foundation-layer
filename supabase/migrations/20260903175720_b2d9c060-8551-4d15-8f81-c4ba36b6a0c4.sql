CREATE OR REPLACE FUNCTION public.wh_flash_report(_org_id uuid, _start date, _end date, _month date, _community_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  today date := current_date;
  m_start date := date_trunc('month', _month)::date;
  m_end date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  nm_start date := (date_trunc('month', _month) + interval '1 month')::date;
  nm_end date := (date_trunc('month', _month) + interval '2 month - 1 day')::date;
  ws date; we date; cs date; ce date; idx int := 0;
  weeks jsonb := '[]'::jsonb;
  occ jsonb; week_occ jsonb; row_json jsonb;
  cur_occupied int; census int;
  month_json jsonb; week_json jsonb;

  -- Forward-looking projection helper.
  -- projected = CURRENT canonical occupied units + pending MIs - pending MOs,
  -- over the SAME canonical census denominator used by current occupancy.
  -- Only meaningful for an in-progress period: historical periods have no
  -- captured pending state and must never borrow today's.
  FUNCTION_PLACEHOLDER text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);
  cur_occupied := COALESCE((occ->>'occupiedUnits')::int, 0);
  census := COALESCE((occ->>'censusUnits')::int, 0);

  ws := public.flash_week_start(m_start);
  LOOP
    we := ws + 6;
    EXIT WHEN ws > m_end;
    cs := GREATEST(ws, m_start);
    ce := LEAST(we, m_end);
    idx := idx + 1;
    IF today BETWEEN cs AND ce THEN
      week_occ := occ || jsonb_build_object('source', 'current');
    ELSE
      week_occ := public.wh_snapshot_asof(_org_id, scope, ce, 1);
    END IF;
    row_json := public.wh_flash_period_metrics(_org_id, scope, cs, ce)
      || jsonb_build_object(
           'label', 'WK ' || idx,
           'isCurrent', (today BETWEEN cs AND ce),
           'budget', public.flash_budget_units(_org_id, scope, ce),
           'occupancy', week_occ);
    IF today BETWEEN cs AND ce AND census > 0 THEN
      row_json := row_json || jsonb_build_object(
        'projectedOccupiedUnits', cur_occupied + (row_json->>'pendingIn')::int - (row_json->>'pendingOut')::int,
        'projectedCensusUnits', census,
        'projectedOccupancyPct',
          round(((cur_occupied + (row_json->>'pendingIn')::int - (row_json->>'pendingOut')::int)::numeric
                 / census) * 100, 2),
        'projectedOverCapacity',
          (cur_occupied + (row_json->>'pendingIn')::int - (row_json->>'pendingOut')::int) > census,
        'projectedBasis', 'current_occupancy_plus_pending');
    ELSE
      row_json := row_json || jsonb_build_object(
        'projectedOccupiedUnits', NULL,
        'projectedOccupancyPct', NULL,
        'projectedOverCapacity', false,
        'projectedBasis', 'unavailable_no_historical_pending_state');
    END IF;
    weeks := weeks || jsonb_build_array(row_json);
    ws := ws + 7;
  END LOOP;

  month_json := public.wh_flash_period_metrics(_org_id, scope, m_start, m_end)
    || jsonb_build_object('label', 'MONTH END',
                          'budget', public.flash_budget_units(_org_id, scope, m_end),
                          'occupancy', CASE WHEN today BETWEEN m_start AND m_end
                                            THEN occ || jsonb_build_object('source','current')
                                            ELSE public.wh_snapshot_asof(_org_id, scope, m_end, 1) END);
  IF today BETWEEN m_start AND m_end AND census > 0 THEN
    month_json := month_json || jsonb_build_object(
      'projectedOccupiedUnits', cur_occupied + (month_json->>'pendingIn')::int - (month_json->>'pendingOut')::int,
      'projectedCensusUnits', census,
      'projectedOccupancyPct',
        round(((cur_occupied + (month_json->>'pendingIn')::int - (month_json->>'pendingOut')::int)::numeric
               / census) * 100, 2),
      'projectedOverCapacity',
        (cur_occupied + (month_json->>'pendingIn')::int - (month_json->>'pendingOut')::int) > census,
      'projectedBasis', 'current_occupancy_plus_pending');
  ELSE
    month_json := month_json || jsonb_build_object(
      'projectedOccupiedUnits', NULL,
      'projectedOccupancyPct', NULL,
      'projectedOverCapacity', false,
      'projectedBasis', 'unavailable_no_historical_pending_state');
  END IF;

  week_json := public.wh_flash_period_metrics(_org_id, scope, _start, _end)
    || jsonb_build_object('label', 'Selected Flash week',
                          'isCurrent', (today BETWEEN _start AND _end),
                          'budget', public.flash_budget_units(_org_id, scope, _end),
                          'occupancy', CASE WHEN today BETWEEN _start AND _end
                                            THEN occ || jsonb_build_object('source','current')
                                            ELSE public.wh_snapshot_asof(_org_id, scope, _end, 1) END);

  RETURN jsonb_build_object(
    'week', week_json,
    'month', month_json,
    'nextMonth', public.wh_flash_period_metrics(_org_id, scope, nm_start, nm_end)
              || jsonb_build_object('label', 'Next month'),
    'starting', jsonb_build_object(
        'label', 'Starting #',
        'asOfDate', m_start - 1,
        'occupancy', public.wh_snapshot_asof(_org_id, scope, m_start - 1, 7),
        'budget', public.flash_budget_units(_org_id, scope, m_start - 1)),
    'weeks', weeks,
    'occupancy', occ || jsonb_build_object('source','current'),
    'budget', public.flash_budget_units(_org_id, scope, today),
    'monthStart', m_start,
    'monthEnd', m_end,
    'communities', COALESCE(array_length(scope, 1), 0),
    'generatedAt', now()
  );
END; $function$;