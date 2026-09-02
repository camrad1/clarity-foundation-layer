-- Server-side WelcomeHome sales metrics. SECURITY INVOKER on purpose:
-- every underlying read stays subject to the caller's RLS policies.

CREATE OR REPLACE FUNCTION public.wh_sales_summary(
  _org_id uuid,
  _start date,
  _end date,
  _community_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  all_c boolean := COALESCE(array_length(_community_ids, 1), 0) = 0;
  tour_ids text[];
  retour_ids text[];
  hot_ids text[];
  now_ts timestamptz := now();
  today date := current_date;
  res jsonb;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

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
  SELECT array_agg(score_id) INTO hot_ids
    FROM public.wh_score_mappings
   WHERE organization_id = _org_id AND level = 'hot';

  WITH p AS (
    SELECT pr.id, pr.source_id, pr.community_id, pr.status, pr.stage_id, pr.score_id,
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
       AND (all_c OR pr.community_id = ANY(_community_ids))
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
           ac.completed_at, ac.completed_local_date, ac.discarded_at
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND (all_c OR ac.community_id = ANY(_community_ids))
  ),
  ap AS (
    SELECT * FROM a
     WHERE discarded_at IS NULL AND completed_at IS NOT NULL
       AND completed_local_date BETWEEN _start AND _end
  ),
  k AS (
    SELECT hc.id, hc.prospect_source_id, hc.unit_source_id, hc.notice_date,
           hc.count_move_in, hc.count_move_out, hc.sales_counselor_id,
           hc.deposit_amount, hc.deposit_received_date,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date,
           (CASE WHEN s.move_out_date_field = 'financial_move_out_date'
                 THEN hc.financial_move_out_date ELSE hc.move_out_date END) AS mo_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND (all_c OR hc.community_id = ANY(_community_ids))
  ),
  dp AS (
    SELECT dt.id, dt.prospect_source_id, dt.occurred_local_date
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id
       AND (all_c OR dt.community_id = ANY(_community_ids))
       AND dt.discarded_at IS NULL AND dt.refunded_at IS NULL
  ),
  u AS (
    SELECT un.off_census, un.source_id
      FROM public.wh_units un
     WHERE un.organization_id = _org_id
       AND (all_c OR un.community_id = ANY(_community_ids))
  ),
  cohort AS (SELECT * FROM pc WHERE inq_local_date BETWEEN _start AND _end),
  counselor_rows AS (
    SELECT user_id_source AS cid, count(*)::int AS acts,
           count(*) FILTER (WHERE tour_ids IS NOT NULL AND activity_type_id = ANY(tour_ids))::int AS tours,
           0 AS move_ins, 0 AS pipeline
      FROM ap WHERE user_id_source IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT sales_counselor_id, 0, 0, count(*)::int, 0
      FROM k WHERE sales_counselor_id IS NOT NULL AND count_move_in IS TRUE
       AND mi_date BETWEEN _start AND _end GROUP BY 1
    UNION ALL
    SELECT current_sales_counselor_id, 0, 0, 0, count(*)::int
      FROM open_p WHERE current_sales_counselor_id IS NOT NULL GROUP BY 1
  ),
  source_rows AS (
    SELECT COALESCE(lead_source_id, 'unknown') AS sid, count(*)::int AS inquiries, 0 AS move_ins
      FROM cohort GROUP BY 1
    UNION ALL
    SELECT COALESCE(pp.lead_source_id, 'unknown'), 0, count(*)::int
      FROM k JOIN p pp ON pp.source_id = k.prospect_source_id
     WHERE k.count_move_in IS TRUE AND k.mi_date BETWEEN _start AND _end GROUP BY 1
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
    'tours', (SELECT count(*)::int FROM ap WHERE tour_ids IS NOT NULL AND activity_type_id = ANY(tour_ids)),
    'reTours', (SELECT count(*)::int FROM ap WHERE retour_ids IS NOT NULL AND activity_type_id = ANY(retour_ids)),
    'deposits', CASE WHEN s.deposit_source = 'housing_contracts'
        THEN (SELECT count(*)::int FROM k WHERE deposit_amount IS NOT NULL AND deposit_received_date BETWEEN _start AND _end)
        ELSE (SELECT count(*)::int FROM dp WHERE occurred_local_date BETWEEN _start AND _end) END,
    'depositRecon', jsonb_build_object(
      'fromTransactions', (SELECT count(*)::int FROM dp WHERE occurred_local_date BETWEEN _start AND _end),
      'fromContracts', (SELECT count(*)::int FROM k WHERE deposit_amount IS NOT NULL AND deposit_received_date BETWEEN _start AND _end)
    ),
    'moveIns', (SELECT count(*)::int FROM k WHERE count_move_in IS TRUE AND mi_date BETWEEN _start AND _end),
    'moveOuts', (SELECT count(*)::int FROM k WHERE count_move_out IS TRUE AND mo_date BETWEEN _start AND _end),
    'pending', jsonb_build_object(
      'pendingIn', (SELECT count(*)::int FROM k WHERE count_move_in IS TRUE AND mi_date > today),
      'pendingOut', (SELECT count(*)::int FROM k WHERE count_move_out IS TRUE AND mo_date > today)
    ),
    'pipeline', (SELECT count(*)::int FROM open_p),
    'hot', (SELECT count(*)::int FROM open_p WHERE hot_ids IS NOT NULL AND score_id = ANY(hot_ids)),
    'hotNoActivity', (SELECT count(*)::int FROM open_p
        WHERE hot_ids IS NOT NULL AND score_id = ANY(hot_ids)
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
           AND a.activity_type_id = ANY(tour_ids)) END,
      'deposited', (SELECT count(DISTINCT dp.prospect_source_id)::int FROM dp
          JOIN cohort ch ON ch.source_id = dp.prospect_source_id),
      'movedIn', (SELECT count(DISTINCT k.prospect_source_id)::int FROM k
          JOIN cohort ch ON ch.source_id = k.prospect_source_id
         WHERE k.count_move_in IS TRUE AND k.mi_date IS NOT NULL),
      'linkageCoverage', (SELECT CASE WHEN count(*) = 0 THEN NULL
          ELSE count(*) FILTER (WHERE prospect_source_id IS NOT NULL)::numeric / count(*)::numeric END FROM a)
    ),
    'counselors', COALESCE((SELECT jsonb_agg(x ORDER BY x.activities DESC) FROM (
        SELECT cid AS id, sum(acts)::int AS activities, sum(tours)::int AS tours,
               sum(move_ins)::int AS "moveIns", sum(pipeline)::int AS pipeline
          FROM counselor_rows GROUP BY cid ORDER BY 2 DESC LIMIT 500) x), '[]'::jsonb),
    'leadSources', COALESCE((SELECT jsonb_agg(x ORDER BY x.inquiries DESC) FROM (
        SELECT sid AS id, sum(inquiries)::int AS inquiries, sum(move_ins)::int AS "moveIns"
          FROM source_rows GROUP BY sid ORDER BY 2 DESC LIMIT 500) x), '[]'::jsonb),
    'utm', (SELECT jsonb_build_object(
        'total', count(*)::int,
        'counts', jsonb_build_object(
          'utm_source', count(*) FILTER (WHERE COALESCE(metadata->>'utm_source', '') <> '')::int,
          'utm_medium', count(*) FILTER (WHERE COALESCE(metadata->>'utm_medium', '') <> '')::int,
          'utm_campaign', count(*) FILTER (WHERE COALESCE(metadata->>'utm_campaign', '') <> '')::int,
          'utm_term', count(*) FILTER (WHERE COALESCE(metadata->>'utm_term', '') <> '')::int,
          'utm_content', count(*) FILTER (WHERE COALESCE(metadata->>'utm_content', '') <> '')::int
        )) FROM p),
    'occupancy', jsonb_build_object(
      'totalUnits', (SELECT count(*)::int FROM u),
      'offCensusUnits', (SELECT count(*) FILTER (WHERE off_census IS TRUE)::int FROM u),
      'censusUnits', (SELECT count(*) FILTER (WHERE off_census IS DISTINCT FROM true)::int FROM u),
      'occupiedUnitsCandidate', (SELECT count(DISTINCT unit_source_id)::int FROM k
          WHERE unit_source_id IS NOT NULL AND mi_date IS NOT NULL AND mi_date <= today
            AND (mo_date IS NULL OR mo_date > today)),
      'noticeCount', (SELECT count(*)::int FROM k
          WHERE notice_date IS NOT NULL AND notice_date <= today AND (mo_date IS NULL OR mo_date > today)),
      'pendingMoveIns', (SELECT count(*)::int FROM k WHERE mi_date > today)
    ),
    'stageDistribution', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT COALESCE(stage_id, 'unknown') AS id, count(*)::int AS n
          FROM open_p GROUP BY 1 ORDER BY 2 DESC LIMIT 200) x), '[]'::jsonb),
    'generatedAt', to_jsonb(now_ts)
  ) INTO res;

  RETURN res;
END; $$;

REVOKE ALL ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) TO authenticated, service_role;

-- Paginated drill-through over prospect buckets.
CREATE OR REPLACE FUNCTION public.wh_prospect_page(
  _org_id uuid,
  _bucket text DEFAULT 'pipeline',
  _community_ids uuid[] DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE(
  id uuid, source_id text, community_id uuid, stage_id text, score_id text,
  status text, next_activity_scheduled_at timestamptz, last_contact_at timestamptz,
  current_sales_counselor_id text, total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  all_c boolean := COALESCE(array_length(_community_ids, 1), 0) = 0;
  hot_ids text[];
  lim int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
  off_ int := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT COALESCE(x.stalled_threshold_days, 14) AS stalled_threshold_days,
         COALESCE(x.hot_no_activity_mode, 'none_scheduled') AS hot_no_activity_mode,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(score_id) INTO hot_ids
    FROM public.wh_score_mappings WHERE organization_id = _org_id AND level = 'hot';

  RETURN QUERY
  WITH open_p AS (
    SELECT pr.* FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id
       AND (all_c OR pr.community_id = ANY(_community_ids))
       AND (NOT s.exclude_merged_prospects OR pr.merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR pr.discarded_at IS NULL)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) NOT IN ('closed', 'lost', 'inactive')
  ),
  sel AS (
    SELECT * FROM open_p o
     WHERE CASE _bucket
       WHEN 'overdue' THEN o.next_activity_scheduled_at IS NOT NULL AND o.next_activity_scheduled_at < now()
       WHEN 'hot' THEN hot_ids IS NOT NULL AND o.score_id = ANY(hot_ids)
       WHEN 'hot_no_activity' THEN hot_ids IS NOT NULL AND o.score_id = ANY(hot_ids)
            AND (o.next_activity_scheduled_at IS NULL
                 OR (s.hot_no_activity_mode = 'none_or_overdue' AND o.next_activity_scheduled_at < now()))
       WHEN 'stalled' THEN COALESCE(o.last_contact_at, o.created_at_source) IS NULL
            OR COALESCE(o.last_contact_at, o.created_at_source) < now() - make_interval(days => s.stalled_threshold_days)
       ELSE true END
  )
  SELECT sel.id, sel.source_id, sel.community_id, sel.stage_id, sel.score_id, sel.status,
         sel.next_activity_scheduled_at, sel.last_contact_at, sel.current_sales_counselor_id,
         count(*) OVER ()
    FROM sel
   ORDER BY sel.next_activity_scheduled_at NULLS LAST, sel.source_id
   LIMIT lim OFFSET off_;
END; $$;

REVOKE ALL ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], int, int) TO authenticated, service_role;

-- Stored volume vs latest sync persisted counts.
CREATE OR REPLACE FUNCTION public.wh_data_completeness(
  _org_id uuid,
  _community_ids uuid[] DEFAULT NULL
) RETURNS TABLE(source_table text, stored_rows bigint, last_sync_rows bigint, last_sync_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  all_c boolean := COALESCE(array_length(_community_ids, 1), 0) = 0;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  RETURN QUERY
  WITH stored AS (
    SELECT 'Prospects'::text t, count(*) n FROM public.wh_prospects x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
    UNION ALL SELECT 'Activities', count(*) FROM public.wh_activities x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
    UNION ALL SELECT 'HousingContracts', count(*) FROM public.wh_housing_contracts x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
    UNION ALL SELECT 'DepositTransactions', count(*) FROM public.wh_deposit_transactions x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
    UNION ALL SELECT 'MarketingTouchpoints', count(*) FROM public.wh_marketing_touchpoints x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
    UNION ALL SELECT 'Units', count(*) FROM public.wh_units x
      WHERE x.organization_id = _org_id AND (all_c OR x.community_id = ANY(_community_ids))
  ),
  runs AS (
    SELECT DISTINCT ON (r.source_table) r.source_table,
           (COALESCE(r.rows_inserted, 0) + COALESCE(r.rows_updated, 0))::bigint AS n,
           r.completed_at
      FROM public.wh_sync_table_runs r
     WHERE r.organization_id = _org_id
     ORDER BY r.source_table, r.started_at DESC
  )
  SELECT stored.t, stored.n, runs.n, runs.completed_at
    FROM stored LEFT JOIN runs ON runs.source_table = stored.t
   ORDER BY stored.t;
END; $$;

REVOKE ALL ON FUNCTION public.wh_data_completeness(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.wh_data_completeness(uuid, uuid[]) TO authenticated, service_role;