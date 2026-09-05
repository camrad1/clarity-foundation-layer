CREATE OR REPLACE FUNCTION public.wh_conversion_rates(
  _org_id uuid,
  _start date,
  _end date,
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
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
  ok_ids text[];
  today date := current_date;
  res jsonb;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  PERFORM set_config('statement_timeout', '60s', true);

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
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings
   WHERE organization_id = _org_id AND category = 'tour';
  ok_ids := public.wh_successful_result_ids(_org_id);

  WITH p AS (
    SELECT pr.id, pr.source_id, pr.community_id, pr.lead_source_id,
           pr.current_sales_counselor_id, pr.merged_into_prospect_id, pr.discarded_at,
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
  a AS (
    SELECT ac.community_id, ac.activity_type_id, ac.prospect_source_id,
           ac.completed_local_date, ac.first_completed_of_type,
           (ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)) AS ok
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id
       AND ac.community_id = ANY(scope)
       AND ac.discarded_at IS NULL
       AND ac.completed_at IS NOT NULL
       AND tour_ids IS NOT NULL
       AND ac.activity_type_id = ANY(tour_ids)
  ),
  tours_ok AS (SELECT * FROM a WHERE ok),
  tours_period AS (SELECT * FROM tours_ok WHERE completed_local_date BETWEEN _start AND _end),
  k AS (
    SELECT hc.community_id, hc.prospect_source_id, hc.count_move_in,
           (CASE WHEN s.move_in_date_field = 'financial_move_in_date'
                 THEN hc.financial_move_in_date ELSE hc.move_in_date END) AS mi_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id
       AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  ),
  mi AS (SELECT * FROM k WHERE count_move_in IS TRUE),
  dp AS (
    SELECT dt.community_id, dt.prospect_source_id, dt.occurred_local_date,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id
       AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit'
       AND dt.deposit_type = 'Deposit'
       AND COALESCE(dt.amount, 0) > 0
  ),
  tset AS (SELECT DISTINCT prospect_source_id AS sid FROM tours_ok WHERE prospect_source_id IS NOT NULL),
  dset AS (SELECT DISTINCT prospect_source_id AS sid FROM dp WHERE prospect_source_id IS NOT NULL),
  mset AS (SELECT DISTINCT prospect_source_id AS sid FROM mi WHERE prospect_source_id IS NOT NULL),
  cohort AS (SELECT * FROM pc WHERE inq_local_date BETWEEN _start AND _end),
  cf AS (
    SELECT ch.community_id, ch.lead_source_id, ch.current_sales_counselor_id, ch.inq_local_date,
           (today - ch.inq_local_date) AS age_days,
           (t.sid IS NOT NULL) AS toured,
           (d.sid IS NOT NULL) AS deposited,
           (m.sid IS NOT NULL) AS moved_in
      FROM cohort ch
      LEFT JOIN tset t ON t.sid = ch.source_id
      LEFT JOIN dset d ON d.sid = ch.source_id
      LEFT JOIN mset m ON m.sid = ch.source_id
  )
  SELECT jsonb_build_object(
    'scopeCommunities', COALESCE(array_length(scope, 1), 0),
    'mappings', jsonb_build_object('tour', COALESCE(array_length(tour_ids, 1), 0) > 0),
    'period', jsonb_build_object(
      'inquiries', (SELECT count(*)::int FROM cohort),
      'tours', (SELECT count(*)::int FROM tours_period),
      'reTours', (SELECT count(*)::int FROM tours_period WHERE first_completed_of_type IS FALSE),
      'deposits', (SELECT count(*)::int FROM (
          SELECT DISTINCT community_id, depositor_key FROM dp
           WHERE occurred_local_date BETWEEN _start AND _end) q),
      'moveIns', (SELECT count(*)::int FROM mi WHERE mi_date BETWEEN _start AND _end)
    ),
    'cohort', jsonb_build_object(
      'size', (SELECT count(*)::int FROM cf),
      'toured', CASE WHEN COALESCE(array_length(tour_ids, 1), 0) = 0 THEN NULL
                     ELSE (SELECT count(*) FILTER (WHERE toured)::int FROM cf) END,
      'deposited', (SELECT count(*) FILTER (WHERE deposited)::int FROM cf),
      'movedIn', (SELECT count(*) FILTER (WHERE moved_in)::int FROM cf),
      'touredThenDeposited', (SELECT count(*) FILTER (WHERE toured AND deposited)::int FROM cf),
      'depositedThenMovedIn', (SELECT count(*) FILTER (WHERE deposited AND moved_in)::int FROM cf)
    ),
    'maturity', COALESCE((SELECT jsonb_agg(x ORDER BY ord) FROM (
        SELECT CASE WHEN age_days < 30 THEN 1 WHEN age_days < 60 THEN 2 WHEN age_days < 90 THEN 3 ELSE 4 END AS ord,
               jsonb_build_object(
                 'bucket', CASE WHEN age_days < 30 THEN '0-29 days'
                                WHEN age_days < 60 THEN '30-59 days'
                                WHEN age_days < 90 THEN '60-89 days'
                                ELSE '90+ days' END,
                 'size', count(*)::int,
                 'toured', count(*) FILTER (WHERE toured)::int,
                 'deposited', count(*) FILTER (WHERE deposited)::int,
                 'movedIn', count(*) FILTER (WHERE moved_in)::int) AS x
          FROM cf GROUP BY 1, CASE WHEN age_days < 30 THEN '0-29 days'
                                   WHEN age_days < 60 THEN '30-59 days'
                                   WHEN age_days < 90 THEN '60-89 days'
                                   ELSE '90+ days' END) q), '[]'::jsonb),
    'byLeadSource', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'inquiries')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'id', COALESCE(lead_source_id, 'unknown'),
                 'inquiries', count(*)::int,
                 'toured', count(*) FILTER (WHERE toured)::int,
                 'deposited', count(*) FILTER (WHERE deposited)::int,
                 'movedIn', count(*) FILTER (WHERE moved_in)::int) AS x
          FROM cf GROUP BY COALESCE(lead_source_id, 'unknown')) q), '[]'::jsonb),
    'byCounselor', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'inquiries')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'id', COALESCE(current_sales_counselor_id, 'unassigned'),
                 'inquiries', count(*)::int,
                 'toured', count(*) FILTER (WHERE toured)::int,
                 'deposited', count(*) FILTER (WHERE deposited)::int,
                 'movedIn', count(*) FILTER (WHERE moved_in)::int) AS x
          FROM cf GROUP BY COALESCE(current_sales_counselor_id, 'unassigned')) q), '[]'::jsonb),
    'byCommunity', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'inquiries')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'id', cid,
                 'inquiries', sum(inq)::int,
                 'toured', sum(toured)::int,
                 'deposited', sum(deposited)::int,
                 'movedIn', sum(moved_in)::int,
                 'periodTours', sum(ptours)::int,
                 'periodDeposits', sum(pdeps)::int,
                 'periodMoveIns', sum(pmi)::int) AS x
          FROM (
            SELECT community_id AS cid, count(*) AS inq,
                   count(*) FILTER (WHERE toured) AS toured,
                   count(*) FILTER (WHERE deposited) AS deposited,
                   count(*) FILTER (WHERE moved_in) AS moved_in,
                   0 AS ptours, 0 AS pdeps, 0 AS pmi
              FROM cf GROUP BY community_id
            UNION ALL
            SELECT community_id, 0, 0, 0, 0, count(*), 0, 0
              FROM tours_period GROUP BY community_id
            UNION ALL
            SELECT community_id, 0, 0, 0, 0, 0, count(*), 0
              FROM (SELECT DISTINCT community_id, depositor_key FROM dp
                     WHERE occurred_local_date BETWEEN _start AND _end) dd
             GROUP BY community_id
            UNION ALL
            SELECT community_id, 0, 0, 0, 0, 0, 0, count(*)
              FROM mi WHERE mi_date BETWEEN _start AND _end GROUP BY community_id
          ) u GROUP BY cid) q), '[]'::jsonb),
    'asOf', today,
    'generatedAt', now()
  ) INTO res;

  RETURN res;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_conversion_rates(uuid, date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.wh_conversion_rates(uuid, date, date, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.wh_conversion_series(
  _org_id uuid,
  _start date,
  _end date,
  _grain text DEFAULT 'month',
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
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
  ok_ids text[];
  g text := CASE WHEN _grain IN ('day', 'week', 'month') THEN _grain ELSE 'month' END;
  res jsonb;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  PERFORM set_config('statement_timeout', '60s', true);

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
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(activity_type_id) INTO tour_ids
    FROM public.wh_activity_type_mappings
   WHERE organization_id = _org_id AND category = 'tour';
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
     WHERE pr.organization_id = _org_id
       AND pr.community_id = ANY(scope)
  ),
  cohort AS (
    SELECT * FROM p
     WHERE (NOT s.exclude_merged_prospects OR merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR discarded_at IS NULL)
       AND inq_local_date BETWEEN _start AND _end
  ),
  tset AS (
    SELECT DISTINCT ac.prospect_source_id AS sid
      FROM public.wh_activities ac
     WHERE ac.organization_id = _org_id AND ac.community_id = ANY(scope)
       AND ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
       AND tour_ids IS NOT NULL AND ac.activity_type_id = ANY(tour_ids)
       AND ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)
       AND ac.prospect_source_id IS NOT NULL
  ),
  dset AS (
    SELECT DISTINCT dt.prospect_source_id AS sid
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL AND dt.transaction_type = 'Deposit'
       AND dt.deposit_type = 'Deposit' AND COALESCE(dt.amount, 0) > 0
       AND dt.prospect_source_id IS NOT NULL
  ),
  mset AS (
    SELECT DISTINCT hc.prospect_source_id AS sid
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
       AND hc.prospect_source_id IS NOT NULL
  ),
  b AS (
    SELECT date_trunc(g, ch.inq_local_date::timestamp)::date AS bucket,
           (t.sid IS NOT NULL) AS toured,
           (d.sid IS NOT NULL) AS deposited,
           (m.sid IS NOT NULL) AS moved_in
      FROM cohort ch
      LEFT JOIN tset t ON t.sid = ch.source_id
      LEFT JOIN dset d ON d.sid = ch.source_id
      LEFT JOIN mset m ON m.sid = ch.source_id
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY bucket), '[]'::jsonb) INTO res
    FROM (
      SELECT bucket, jsonb_build_object(
               'bucket', bucket,
               'inquiries', count(*)::int,
               'toured', count(*) FILTER (WHERE toured)::int,
               'deposited', count(*) FILTER (WHERE deposited)::int,
               'movedIn', count(*) FILTER (WHERE moved_in)::int) AS x
        FROM b GROUP BY bucket) q;

  RETURN jsonb_build_object('grain', g, 'points', res, 'generatedAt', now());
END; $function$;

REVOKE ALL ON FUNCTION public.wh_conversion_series(uuid, date, date, text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.wh_conversion_series(uuid, date, date, text, uuid[]) TO authenticated;

UPDATE public.metric_definitions SET
  source_type = 'welcomehome',
  source_table = 'wh_prospects + wh_activities',
  date_field = 'inquiry date (cohort)',
  description = 'Cohort conversion: of countable prospects whose inquiry date falls in the period, the share with at least one successful tour activity at any later date.',
  calculation_definition = jsonb_build_object(
    'engine', 'public.wh_conversion_rates',
    'cohort', 'prospects with inquiry date in period (community-local)',
    'numerator', 'DISTINCT cohort prospects with >=1 completed tour activity with a successful result (any date)',
    'denominator', 'cohort size',
    'exclusions', 'merged and discarded prospects per wh_settings; unsuccessful tour results',
    'min_sample', 20,
    'note', 'Cohort is open-ended forward in time; young cohorts are not yet mature.'
  ),
  updated_at = now()
 WHERE metric_key = 'wh.lead_to_tour';

UPDATE public.metric_definitions SET
  source_type = 'welcomehome',
  source_table = 'wh_prospects + wh_deposit_transactions',
  date_field = 'inquiry date (cohort)',
  description = 'Cohort conversion: of prospects who toured from the inquiry cohort, the share with a standard deposit at any later date. PROVISIONAL - inherits the provisional status of the deposit metric.',
  calculation_definition = jsonb_build_object(
    'engine', 'public.wh_conversion_rates',
    'cohort', 'prospects with inquiry date in period who also completed a successful tour',
    'numerator', 'DISTINCT those prospects with a standard deposit (type Deposit, amount > 0, any date)',
    'denominator', 'cohort prospects who toured',
    'exclusions', 'merged/discarded prospects; refunds, waitlist and zero-amount deposits',
    'min_sample', 20,
    'provisional', true
  ),
  updated_at = now()
 WHERE metric_key = 'wh.tour_to_deposit';

UPDATE public.metric_definitions SET
  source_type = 'welcomehome',
  source_table = 'wh_prospects + wh_housing_contracts',
  date_field = 'inquiry date (cohort)',
  description = 'Cohort conversion: of countable prospects whose inquiry date falls in the period, the share with a counted move-in on a non-canceled contract at any later date.',
  calculation_definition = jsonb_build_object(
    'engine', 'public.wh_conversion_rates',
    'cohort', 'prospects with inquiry date in period (community-local)',
    'numerator', 'DISTINCT cohort prospects with a non-canceled contract where count_move_in is true',
    'denominator', 'cohort size',
    'exclusions', 'merged/discarded prospects; canceled leases; transfers (count_move_in false)',
    'min_sample', 20
  ),
  updated_at = now()
 WHERE metric_key = 'wh.lead_to_movein';

INSERT INTO public.metric_definitions
  (organization_id, metric_key, name, description, source_type, source_table, date_field,
   calculation_definition, exclusion_rules, supported_dimensions, metric_version, status, validation_status)
SELECT o.id, 'wh.deposit_to_movein', 'Deposit to Move-In Conversion',
       'Cohort conversion: of prospects from the inquiry cohort who placed a deposit, the share that moved in. PROVISIONAL - inherits the provisional status of the deposit metric.',
       'welcomehome', 'wh_deposit_transactions + wh_housing_contracts', 'inquiry date (cohort)',
       jsonb_build_object(
         'engine', 'public.wh_conversion_rates',
         'cohort', 'prospects with inquiry date in period who placed a standard deposit',
         'numerator', 'DISTINCT those prospects with a counted move-in (any date)',
         'denominator', 'cohort prospects who deposited',
         'min_sample', 20,
         'provisional', true),
       '{}'::jsonb, ARRAY['community', 'lead_source', 'counselor']::text[], 1, 'provisional', 'unvalidated'
  FROM public.organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM public.metric_definitions m
    WHERE m.organization_id = o.id AND m.metric_key = 'wh.deposit_to_movein');