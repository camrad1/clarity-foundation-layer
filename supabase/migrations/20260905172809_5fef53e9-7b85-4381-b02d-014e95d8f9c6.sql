CREATE OR REPLACE FUNCTION public.wh_sales_summary(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  s record;
  scope uuid[];
  tour_ids text[];
  retour_ids text[];
  hot_ids text[];
  ok_ids text[];
  ok_labels text[];
  now_ts timestamptz := now();
  today date := current_date;
  res jsonb;
  pseudo_patterns text[];
  v_occ jsonb;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Heavy executive report: allow up to 60s for this request (default role limit is 8s).
  PERFORM set_config('statement_timeout', '60s', true);

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);
  v_occ := public.wh_flash_occupancy(_org_id, scope);

  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field, 'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field, 'move_out_date') AS move_out_date_field,
         COALESCE(x.deposit_source, 'deposit_transactions') AS deposit_source,
         COALESCE(x.stalled_threshold_days, 14) AS stalled_threshold_days,
         COALESCE(x.hot_no_activity_mode, 'none_scheduled') AS hot_no_activity_mode,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings
   WHERE organization_id = _org_id AND category = 'tour';
  SELECT array_agg(activity_type_id) INTO retour_ids
    FROM public.wh_activity_type_mappings
   WHERE organization_id = _org_id AND category = 're_tour';
  SELECT array_agg(sm.score_id) INTO hot_ids
    FROM public.wh_score_mappings sm
   WHERE sm.organization_id = _org_id AND sm.level = 'hot';
  ok_ids := public.wh_successful_result_ids(_org_id);
  ok_labels := public.wh_successful_result_labels(_org_id);
  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY['WAITLIST']::text[]) INTO pseudo_patterns
    FROM (SELECT 1) dd LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  pseudo_patterns := COALESCE(pseudo_patterns, ARRAY['WAITLIST']::text[]);

  WITH p AS (
    SELECT pr.id, pr.source_id, pr.community_id, pr.status, pr.stage_id, pr.score_id, pr.score_label,
           pr.lead_source_id, pr.current_sales_counselor_id, pr.merged_into_prospect_id,
           pr.discarded_at, pr.last_contact_at, pr.created_at_source,
           pr.next_activity_scheduled_at, pr.metadata,
           (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END
              AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS inq_local_date
      FROM public.wh_prospects pr
      LEFT JOIN public.communities c ON c.id = pr.community_id
     WHERE pr.organization_id = _org_id
       AND pr.community_id = ANY(scope)
  ),
  pc AS (
    SELECT * FROM p
     WHERE (NOT s.exclude_merged_prospects OR merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR discarded_at IS NULL)
  ),
  open_p AS (
    SELECT * FROM pc
     WHERE discarded_at IS NULL AND merged_into_prospect_id IS NULL
       AND lower(COALESCE(status, '')) NOT IN ('closed', 'lost', 'inactive')
  ),
  a AS (
    SELECT ac.id, ac.activity_type_id, ac.user_id_source, ac.prospect_source_id,
           ac.completed_at, ac.completed_local_date, ac.discarded_at,
           ac.result_label, ac.first_completed_of_type,
           (ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)) AS ok
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND ac.community_id = ANY(scope)
  ),
  ap AS (
    SELECT * FROM a
     WHERE discarded_at IS NULL AND completed_at IS NOT NULL
       AND completed_local_date BETWEEN _start AND _end
  ),
  tours_all AS (
    SELECT * FROM ap WHERE tour_ids IS NOT NULL AND activity_type_id = ANY(tour_ids)
  ),
  tours_ok AS (SELECT * FROM tours_all WHERE ok),
  k AS (
    SELECT hc.id, hc.prospect_source_id, hc.unit_source_id, hc.notice_date,
           hc.count_move_in, hc.count_move_out, hc.sales_counselor_id,
           hc.deposit_amount, hc.deposit_received_date,
           (hc.lease_canceled_on IS NOT NULL) AS canceled,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND hc.community_id = ANY(scope)
  ),
  kc AS (SELECT * FROM k WHERE NOT canceled),
  dall AS (
    SELECT dt.id, dt.prospect_source_id, dt.occurred_local_date, dt.amount,
           dt.transaction_type, dt.deposit_type,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key,
           dt.community_id
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id
       AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL
  ),
  dp AS (
    SELECT * FROM dall
     WHERE transaction_type = 'Deposit' AND deposit_type = 'Deposit'
  ),
  dp_period AS (
    SELECT * FROM dp WHERE occurred_local_date BETWEEN _start AND _end
  ),
  depositors AS (
    SELECT DISTINCT community_id, depositor_key
      FROM dp_period WHERE COALESCE(amount, 0) > 0
  ),
  u AS (
    SELECT un.off_census, un.source_id,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           pseudo_patterns) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id
       AND un.community_id = ANY(scope)
  ),
  cohort AS (SELECT * FROM pc WHERE inq_local_date BETWEEN _start AND _end),
  counselor_rows AS (
    SELECT user_id_source AS cid, count(*)::int AS acts,
           count(*) FILTER (WHERE ok AND tour_ids IS NOT NULL AND activity_type_id = ANY(tour_ids))::int AS tours,
           0 AS move_ins, 0 AS pipeline
      FROM ap WHERE user_id_source IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT sales_counselor_id, 0, 0, count(*)::int, 0
      FROM kc WHERE sales_counselor_id IS NOT NULL AND count_move_in IS TRUE
       AND mi_date BETWEEN _start AND _end GROUP BY 1
    UNION ALL
    SELECT current_sales_counselor_id, 0, 0, 0, count(*)::int
      FROM open_p WHERE current_sales_counselor_id IS NOT NULL GROUP BY 1
  ),
  source_rows AS (
    SELECT COALESCE(lead_source_id, 'unknown') AS sid, count(*)::int AS inquiries, 0 AS tours, 0 AS move_ins
      FROM cohort GROUP BY 1
    UNION ALL
    -- Tours attributed through the touring prospect's recorded WelcomeHome lead
    -- source. Same tours_ok set as the headline tour metric (mapped tour type,
    -- successful result, completed in period); re-tours stay included exactly as
    -- in the headline count.
    SELECT COALESCE(pp.lead_source_id, 'unknown'), 0, count(*)::int, 0
      FROM tours_ok t JOIN p pp ON pp.source_id = t.prospect_source_id GROUP BY 1
    UNION ALL
    SELECT COALESCE(pp.lead_source_id, 'unknown'), 0, 0, count(*)::int
      FROM kc JOIN p pp ON pp.source_id = kc.prospect_source_id
     WHERE kc.count_move_in IS TRUE AND kc.mi_date BETWEEN _start AND _end GROUP BY 1
  )
  SELECT jsonb_build_object(
    'settings', to_jsonb(s),
    'mappings', jsonb_build_object(
      'tour', COALESCE(array_length(tour_ids, 1), 0) > 0,
      're_tour', COALESCE(array_length(retour_ids, 1), 0) > 0,
      'hot', COALESCE(array_length(hot_ids, 1), 0) > 0
    ),
    'exclusions', (SELECT jsonb_build_object(
        'total', count(*)::int,
        'merged', count(*) FILTER (WHERE merged_into_prospect_id IS NOT NULL)::int,
        'discarded', count(*) FILTER (WHERE discarded_at IS NOT NULL AND merged_into_prospect_id IS NULL)::int,
        'countable', (SELECT count(*)::int FROM pc)
      ) FROM p),
    'inquiries', (SELECT count(*)::int FROM cohort),
    'tours', (SELECT count(*)::int FROM tours_ok),
    'reTours', (SELECT count(*)::int FROM tours_ok WHERE first_completed_of_type IS FALSE),
    'tourRecon', jsonb_build_object(
      'totalTourActivities', (SELECT count(*)::int FROM tours_all),
      'successfulTours', (SELECT count(*)::int FROM tours_ok),
      'initialTours', (SELECT count(*)::int FROM tours_ok WHERE first_completed_of_type IS TRUE),
      'repeatTours', (SELECT count(*)::int FROM tours_ok WHERE first_completed_of_type IS FALSE),
      'unsuccessfulTours', (SELECT count(*)::int FROM tours_all WHERE NOT ok),
      'successfulResultLabels', to_jsonb(ok_labels),
      'sourceAttributed', (SELECT count(*)::int FROM tours_ok t JOIN p pp ON pp.source_id = t.prospect_source_id),
      'byResult', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'n' DESC) FROM (
          SELECT jsonb_build_object('result', COALESCE(result_label, 'unknown'),
                                    'successful', bool_or(ok),
                                    'n', count(*)::int) AS x
            FROM tours_all GROUP BY COALESCE(result_label, 'unknown')) q), '[]'::jsonb)
    ),
    'deposits', (SELECT count(*)::int FROM depositors),
    'depositRecon', jsonb_build_object(
      'depositors', (SELECT count(*)::int FROM depositors),
      'fromTransactions', (SELECT count(*)::int FROM dp_period),
      'zeroAmountRows', (SELECT count(*)::int FROM dp_period WHERE COALESCE(amount, 0) = 0),
      'fromContracts', (SELECT count(*)::int FROM k WHERE deposit_amount IS NOT NULL AND deposit_received_date BETWEEN _start AND _end),
      'refunds', (SELECT count(*)::int FROM dall WHERE transaction_type = 'Refund' AND occurred_local_date BETWEEN _start AND _end),
      'waitlist', (SELECT count(*)::int FROM dall WHERE transaction_type = 'Deposit' AND deposit_type = 'Waitlist Deposit' AND occurred_local_date BETWEEN _start AND _end),
      'otherTypes', (SELECT count(*)::int FROM dall WHERE transaction_type = 'Deposit' AND COALESCE(deposit_type, '') NOT IN ('Deposit', 'Waitlist Deposit') AND occurred_local_date BETWEEN _start AND _end)
    ),
    'moveIns', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE AND mi_date BETWEEN _start AND _end),
    'moveOuts', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE AND mo_date BETWEEN _start AND _end),
    'moveRecon', jsonb_build_object(
      'moveIns', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE AND mi_date BETWEEN _start AND _end),
      'transferIns', (SELECT count(*)::int FROM kc WHERE COALESCE(count_move_in, false) = false AND mi_date BETWEEN _start AND _end),
      'canceledMoveIns', (SELECT count(*)::int FROM k WHERE canceled AND count_move_in IS TRUE AND mi_date BETWEEN _start AND _end),
      'moveOuts', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE AND mo_date BETWEEN _start AND _end),
      'transferOuts', (SELECT count(*)::int FROM kc WHERE COALESCE(count_move_out, false) = false AND mo_date BETWEEN _start AND _end),
      'canceledMoveOuts', (SELECT count(*)::int FROM k WHERE canceled AND count_move_out IS TRUE AND mo_date BETWEEN _start AND _end)
    ),
    'pending', jsonb_build_object(
      'pendingIn', (SELECT count(*)::int FROM kc WHERE count_move_in IS TRUE AND mi_date > today),
      'pendingOut', (SELECT count(*)::int FROM kc WHERE count_move_out IS TRUE AND mo_date > today)
    ),
    'pipeline', (SELECT count(*)::int FROM open_p),
    'hot', (SELECT count(*)::int FROM open_p WHERE lower(COALESCE(status, '')) = 'open' AND public.wh_is_hot_score(_org_id, score_id, score_label)),
    'hotNoActivity', (SELECT count(*)::int FROM open_p
        WHERE lower(COALESCE(status, '')) = 'open' AND public.wh_is_hot_score(_org_id, score_id, score_label)
          AND (next_activity_scheduled_at IS NULL
               OR (s.hot_no_activity_mode = 'none_or_overdue' AND next_activity_scheduled_at < now_ts))),
    'stalled', (SELECT count(*)::int FROM open_p
        WHERE COALESCE(last_contact_at, created_at_source) IS NULL
           OR COALESCE(last_contact_at, created_at_source) < now_ts - make_interval(days => s.stalled_threshold_days)),
    'overdue', (SELECT count(*)::int FROM open_p
        WHERE next_activity_scheduled_at IS NOT NULL AND next_activity_scheduled_at < now_ts),
    'cohort', jsonb_build_object(
      'cohortSize', (SELECT count(*)::int FROM cohort),
      'toured', CASE WHEN COALESCE(array_length(tour_ids, 1), 0) = 0 THEN NULL ELSE
        (SELECT count(DISTINCT a.prospect_source_id)::int FROM a
          JOIN cohort ch ON ch.source_id = a.prospect_source_id
         WHERE a.discarded_at IS NULL AND a.completed_at IS NOT NULL
           AND a.ok AND a.activity_type_id = ANY(tour_ids)) END,
      'deposited', (SELECT count(DISTINCT dp.prospect_source_id)::int FROM dp
          JOIN cohort ch ON ch.source_id = dp.prospect_source_id),
      'movedIn', (SELECT count(DISTINCT kc.prospect_source_id)::int FROM kc
          JOIN cohort ch ON ch.source_id = kc.prospect_source_id
         WHERE kc.count_move_in IS TRUE),
      'linkageCoverage', (SELECT CASE WHEN count(*) = 0 THEN NULL
            ELSE count(*) FILTER (WHERE prospect_source_id IS NOT NULL)::numeric / count(*)::numeric END
          FROM ap)
    ),
    'counselors', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'activities' DESC) FROM (
        SELECT jsonb_build_object('id', cid, 'activities', sum(acts)::int, 'tours', sum(tours)::int,
                                  'moveIns', sum(move_ins)::int, 'pipeline', sum(pipeline)::int) AS x
          FROM counselor_rows GROUP BY cid) q), '[]'::jsonb),
    'leadSources', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('id', sid, 'inquiries', sum(inquiries)::int, 'tours', sum(tours)::int,
                                  'moveIns', sum(move_ins)::int) AS x
          FROM source_rows GROUP BY sid ORDER BY sum(inquiries) DESC) q), '[]'::jsonb),
    'utm', (SELECT jsonb_build_object(
        'total', count(*)::int,
        'counts', jsonb_build_object(
          'utm_source', count(*) FILTER (WHERE metadata->>'utm_source' IS NOT NULL)::int,
          'utm_medium', count(*) FILTER (WHERE metadata->>'utm_medium' IS NOT NULL)::int,
          'utm_campaign', count(*) FILTER (WHERE metadata->>'utm_campaign' IS NOT NULL)::int,
          'utm_term', count(*) FILTER (WHERE metadata->>'utm_term' IS NOT NULL)::int,
          'utm_content', count(*) FILTER (WHERE metadata->>'utm_content' IS NOT NULL)::int
        )) FROM pc),
    'occupancy', v_occ
      || jsonb_build_object(
           'occupiedUnitsCandidate', (v_occ->>'occupiedUnits')::int,
           'pendingMoveIns', (SELECT count(*)::int FROM k WHERE count_move_in IS TRUE AND mi_date > today)),
    'stageDistribution', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'n' DESC) FROM (
        SELECT jsonb_build_object('id', COALESCE(stage_id, 'unknown'), 'n', count(*)::int) AS x
          FROM open_p GROUP BY COALESCE(stage_id, 'unknown')) q), '[]'::jsonb),
    'generatedAt', now_ts
  ) INTO res;

  RETURN res;
END; $function$;