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
  month_closed boolean;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);
  cur_occupied := COALESCE((occ->>'occupiedUnits')::int, 0);
  census := COALESCE((occ->>'censusUnits')::int, 0);
  month_closed := today > m_end;

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
                 / census) * 100, 4),
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

  -- MONTH ROW.
  -- Finalized month-end occupancy only exists after the calendar month has
  -- fully ended. During an active month the row is month-to-date: the event
  -- metrics (MI/MO/inquiries/tours…) keep their validated definitions and
  -- accumulate MTD, while every finalized occupancy field stays NULL so the
  -- UI renders "—". Current occupancy lives in Current Weekly Summary and the
  -- forward-looking view lives in the projected month-end fields below.
  month_json := public.wh_flash_period_metrics(_org_id, scope, m_start, m_end)
    || jsonb_build_object('label', CASE WHEN month_closed THEN 'MONTH END' ELSE 'MONTH TO DATE' END,
                          'isMonthClosed', month_closed,
                          'budget', CASE WHEN month_closed
                                         THEN public.flash_budget_units(_org_id, scope, m_end)
                                         ELSE NULL END,
                          'occupancy', CASE WHEN month_closed
                                            THEN public.wh_snapshot_asof(_org_id, scope, m_end, 1)
                                            ELSE NULL END);
  IF today BETWEEN m_start AND m_end AND census > 0 THEN
    month_json := month_json || jsonb_build_object(
      'projectedOccupiedUnits', cur_occupied + (month_json->>'pendingIn')::int - (month_json->>'pendingOut')::int,
      'projectedCensusUnits', census,
      'projectedOccupancyPct',
        round(((cur_occupied + (month_json->>'pendingIn')::int - (month_json->>'pendingOut')::int)::numeric
               / census) * 100, 4),
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
  IF today BETWEEN _start AND _end AND census > 0 THEN
    week_json := week_json || jsonb_build_object(
      'projectedOccupiedUnits', cur_occupied + (week_json->>'pendingIn')::int - (week_json->>'pendingOut')::int,
      'projectedCensusUnits', census,
      'projectedOccupancyPct',
        round(((cur_occupied + (week_json->>'pendingIn')::int - (week_json->>'pendingOut')::int)::numeric
               / census) * 100, 4),
      'projectedOverCapacity',
        (cur_occupied + (week_json->>'pendingIn')::int - (week_json->>'pendingOut')::int) > census,
      'projectedBasis', 'current_occupancy_plus_pending');
  ELSE
    week_json := week_json || jsonb_build_object(
      'projectedOccupiedUnits', NULL,
      'projectedOccupancyPct', NULL,
      'projectedOverCapacity', false,
      'projectedBasis', 'unavailable_no_historical_pending_state');
  END IF;

  RETURN jsonb_build_object(
    'weeks', weeks,
    'month', month_json,
    'week', week_json,
    'occupancy', occ,
    'starting', public.wh_flash_scope_starting(_org_id, scope, m_start),
    'nextMonth', public.wh_flash_period_metrics(_org_id, scope, nm_start, nm_end),
    'generatedAt', now()
  );
END;
$function$;