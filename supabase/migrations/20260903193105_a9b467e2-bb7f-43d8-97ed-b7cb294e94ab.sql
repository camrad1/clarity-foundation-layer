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
  month_closed boolean; month_active boolean;
  month_metrics jsonb; wk_metrics jsonb; week_proj jsonb;
  m_pend_in int; m_pend_out int; proj_occ int;
  wk_in int; wk_out int; running int;
  proj_json jsonb; null_proj jsonb; null_events jsonb;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);
  cur_occupied := COALESCE((occ->>'occupiedUnits')::int, 0);
  census := COALESCE((occ->>'censusUnits')::int, 0);
  month_closed := today > m_end;
  month_active := today BETWEEN m_start AND m_end;

  -- Month rollup: ALL remaining pending activity for the rest of the selected
  -- month as of today. Used by the Current Summary and the month row.
  month_metrics := public.wh_flash_period_metrics(_org_id, scope, m_start, m_end);
  m_pend_in := COALESCE((month_metrics->>'pendingIn')::int, 0);
  m_pend_out := COALESCE((month_metrics->>'pendingOut')::int, 0);
  proj_occ := cur_occupied + m_pend_in - m_pend_out;

  IF month_active AND census > 0 THEN
    proj_json := jsonb_build_object(
      'pendingIn', m_pend_in,
      'pendingOut', m_pend_out,
      'pendingNet', m_pend_in - m_pend_out,
      'projectedOccupiedUnits', proj_occ,
      'projectedCensusUnits', census,
      'projectedOccupancyPct', round((proj_occ::numeric / census) * 100, 4),
      'projectedOverCapacity', proj_occ > census,
      'projectedBasis', 'current_occupancy_plus_pending');
  ELSE
    proj_json := jsonb_build_object(
      'pendingIn', NULL, 'pendingOut', NULL, 'pendingNet', NULL,
      'projectedOccupiedUnits', NULL, 'projectedOccupancyPct', NULL,
      'projectedOverCapacity', false,
      'projectedBasis', 'unavailable_no_historical_pending_state');
  END IF;

  null_proj := jsonb_build_object(
    'pendingIn', NULL, 'pendingOut', NULL, 'pendingNet', NULL,
    'projectedOccupiedUnits', NULL, 'projectedOccupancyPct', NULL,
    'projectedOverCapacity', false,
    'projectedBasis', 'unavailable_no_historical_pending_state');

  -- Actual weekly event metrics do not exist before the period occurs.
  null_events := jsonb_build_object(
    'inquiries', NULL, 'outreach', NULL, 'tours', NULL, 'reTours', NULL,
    'moveIns', NULL, 'moveOuts', NULL, 'net', NULL);

  running := cur_occupied;
  ws := public.flash_week_start(m_start);
  LOOP
    we := ws + 6;
    EXIT WHEN ws > m_end;
    cs := GREATEST(ws, m_start);
    ce := LEAST(we, m_end);
    idx := idx + 1;
    IF today BETWEEN cs AND ce THEN
      week_occ := occ || jsonb_build_object('source', 'current');
    ELSIF cs > today THEN
      week_occ := NULL;
    ELSE
      week_occ := public.wh_snapshot_asof(_org_id, scope, ce, 1);
    END IF;

    -- Pending MIMO bucketed by the week containing the expected move date.
    wk_metrics := public.wh_flash_period_metrics(_org_id, scope, cs, ce);
    wk_in := COALESCE((wk_metrics->>'pendingIn')::int, 0);
    wk_out := COALESCE((wk_metrics->>'pendingOut')::int, 0);

    IF month_active AND census > 0 AND ce >= today THEN
      running := running + wk_in - wk_out;
      week_proj := jsonb_build_object(
        'pendingIn', wk_in,
        'pendingOut', wk_out,
        'pendingNet', wk_in - wk_out,
        'projectedOccupiedUnits', running,
        'projectedCensusUnits', census,
        'projectedOccupancyPct', round((running::numeric / census) * 100, 4),
        'projectedOverCapacity', running > census,
        'projectedBasis', 'cumulative_pending_by_week');
    ELSE
      -- Completed weeks have no preserved point-in-time pending checkpoint.
      week_proj := null_proj;
    END IF;

    IF cs > today THEN
      -- Future week: no completed activity yet, but pending MIMO may be known.
      row_json := jsonb_build_object('start', cs, 'end', ce, 'outreachMapped', true)
        || null_events || week_proj;
    ELSE
      row_json := wk_metrics || week_proj;
    END IF;

    row_json := row_json || jsonb_build_object(
      'label', 'WK ' || idx,
      'isCurrent', (today BETWEEN cs AND ce),
      'budget', CASE WHEN cs > today THEN NULL
                     ELSE public.flash_budget_units(_org_id, scope, ce) END,
      'occupancy', week_occ);

    weeks := weeks || jsonb_build_array(row_json);
    ws := ws + 7;
  END LOOP;

  month_json := month_metrics
    || jsonb_build_object('label', CASE WHEN month_closed THEN 'MONTH END' ELSE 'MONTH TO DATE' END,
                          'isMonthClosed', month_closed,
                          'budget', CASE WHEN month_closed
                                         THEN public.flash_budget_units(_org_id, scope, m_end)
                                         ELSE NULL END,
                          'occupancy', CASE WHEN month_closed
                                            THEN public.wh_snapshot_asof(_org_id, scope, m_end, 1)
                                            ELSE NULL END)
    || proj_json;

  IF _start > today THEN
    week_json := jsonb_build_object('start', _start, 'end', _end, 'outreachMapped', true)
      || null_events || null_proj
      || jsonb_build_object('label', 'Selected Flash week', 'isCurrent', false,
                            'budget', NULL, 'occupancy', NULL);
  ELSE
    week_json := public.wh_flash_period_metrics(_org_id, scope, _start, _end)
      || (CASE WHEN today BETWEEN _start AND _end THEN proj_json ELSE null_proj END)
      || jsonb_build_object('label', 'Selected Flash week',
                            'isCurrent', (today BETWEEN _start AND _end),
                            'budget', public.flash_budget_units(_org_id, scope, _end),
                            'occupancy', CASE WHEN today BETWEEN _start AND _end
                                              THEN occ || jsonb_build_object('source','current')
                                              ELSE public.wh_snapshot_asof(_org_id, scope, _end, 1) END);
  END IF;

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
END;
$function$;