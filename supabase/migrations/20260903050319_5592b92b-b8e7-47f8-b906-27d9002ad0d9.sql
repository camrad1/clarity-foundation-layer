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
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);

  -- Sunday–Saturday cadence, clipped to the selected calendar month so every
  -- date belongs to exactly one month's Flash table and the weekly rows sum to
  -- the MONTH END row.
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
    weeks := weeks || jsonb_build_array(row_json);
    ws := ws + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'week', public.wh_flash_period_metrics(_org_id, scope, _start, _end)
              || jsonb_build_object('label', 'Selected Flash week',
                                    'isCurrent', (today BETWEEN _start AND _end),
                                    'budget', public.flash_budget_units(_org_id, scope, _end),
                                    'occupancy', CASE WHEN today BETWEEN _start AND _end
                                                      THEN occ || jsonb_build_object('source','current')
                                                      ELSE public.wh_snapshot_asof(_org_id, scope, _end, 1) END),
    'month', public.wh_flash_period_metrics(_org_id, scope, m_start, m_end)
              || jsonb_build_object('label', 'MONTH END',
                                    'budget', public.flash_budget_units(_org_id, scope, m_end),
                                    'occupancy', CASE WHEN today BETWEEN m_start AND m_end
                                                      THEN occ || jsonb_build_object('source','current')
                                                      ELSE public.wh_snapshot_asof(_org_id, scope, m_end, 1) END),
    'nextMonth', public.wh_flash_period_metrics(_org_id, scope, nm_start, nm_end)
              || jsonb_build_object('label', 'Next month'),
    -- Starting position going into the month: last snapshot before the first
    -- day of the month. Never reconstructed from current-state rows.
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