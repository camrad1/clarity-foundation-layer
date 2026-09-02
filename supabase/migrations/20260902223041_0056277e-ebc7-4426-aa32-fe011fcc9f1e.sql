ALTER TABLE public.metric_validation_checks
  ADD COLUMN IF NOT EXISTS official_source text,
  ADD COLUMN IF NOT EXISTS evidence_scope text NOT NULL DEFAULT 'historical_period';

CREATE UNIQUE INDEX IF NOT EXISTS metric_validation_checks_unique_evidence
  ON public.metric_validation_checks (organization_id, metric_key, metric_version, coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, evidence_scope);

-- wh.new_inquiries
UPDATE public.metric_definitions SET
  description = 'Count of countable WelcomeHome prospects whose community-local active_at date falls inside the selected period.',
  source_table = 'wh_prospects',
  date_field = 'active_at',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_prospects','communities'),
    'date_field','active_at',
    'timezone','converted AT TIME ZONE communities.timezone before period filtering',
    'rule','COUNT(prospect) WHERE community-local active_at BETWEEN period_start AND period_end',
    'comparison','same calendar period in the prior year/period; no blending of cohort and period-event counts'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','merged prospects excluded','setting','wh_settings.exclude_merged_prospects'),
    jsonb_build_object('rule','discarded prospects excluded','setting','wh_settings.exclude_discarded_prospects')),
  supported_dimensions = ARRAY['community','date','care_type'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.new_inquiries';

-- wh.completed_tours
UPDATE public.metric_definitions SET
  description = 'Completed, non-discarded activities mapped to Tour whose WelcomeHome ActivityResult is flagged successful.',
  source_table = 'wh_activities',
  date_field = 'completed_local_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_activities','wh_activity_type_mappings','wh_lookups (ActivityResults)'),
    'date_field','completed_local_date',
    'rule','COUNT(activity) WHERE activity type maps to category tour AND result_id IN public.wh_successful_result_ids(org) AND completed_local_date in period',
    'successful_match','WelcomeHome ActivityResult source ID with payload.successful = true — never the result label',
    'comparison','prior equivalent period, same community scope'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','discarded activities excluded'),
    jsonb_build_object('rule','activities with a non-successful result excluded'),
    jsonb_build_object('rule','activity types not mapped to Tour excluded')),
  supported_dimensions = ARRAY['community','date','care_type'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.completed_tours';

-- wh.re_tours
UPDATE public.metric_definitions SET
  description = 'Successful tour activities that are not the prospect''s first completed tour of that activity type.',
  source_table = 'wh_activities',
  date_field = 'completed_local_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_activities','wh_activity_type_mappings','wh_lookups (ActivityResults)'),
    'date_field','completed_local_date',
    'rule','COUNT(activity) WHERE metric wh.completed_tours qualifies AND first_completed_of_activity_type = false',
    'sequence_source','WelcomeHome first_completed_of_activity_type flag — never an inferred tour sequence'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','initial tours (first_completed_of_activity_type = true) excluded'),
    jsonb_build_object('rule','all wh.completed_tours exclusions apply')),
  supported_dimensions = ARRAY['community','date','care_type'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.re_tours';

-- wh.move_ins
UPDATE public.metric_definitions SET
  description = 'HousingContracts flagged count_move_in whose financial move-in date falls in the period, excluding canceled leases.',
  source_table = 'wh_housing_contracts',
  date_field = 'financial_move_in_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_housing_contracts'),
    'date_field','financial_move_in_date',
    'rule','COUNT(contract) WHERE count_move_in IS TRUE AND financial_move_in_date in period AND lease_canceled_on IS NULL',
    'drill_through','public.wh_move_in_page',
    'comparison','prior equivalent period, same community scope'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','canceled leases excluded (lease_canceled_on set); rows retained for audit'),
    jsonb_build_object('rule','discarded contracts excluded'),
    jsonb_build_object('rule','Transfer Ins excluded — they carry count_move_in = false in WelcomeHome; the normalized is_transfer flag is NULL portfolio-wide and is not used')),
  supported_dimensions = ARRAY['community','date','care_type'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.move_ins';

-- wh.move_outs
UPDATE public.metric_definitions SET
  description = 'HousingContracts flagged count_move_out whose financial move-out date falls in the period, excluding canceled leases.',
  source_table = 'wh_housing_contracts',
  date_field = 'financial_move_out_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_housing_contracts'),
    'date_field','financial_move_out_date',
    'rule','COUNT(contract) WHERE count_move_out IS TRUE AND financial_move_out_date in period AND lease_canceled_on IS NULL',
    'comparison','prior equivalent period, same community scope'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','canceled leases excluded (lease_canceled_on set); rows retained for audit'),
    jsonb_build_object('rule','discarded contracts excluded'),
    jsonb_build_object('rule','Transfer Outs excluded — they carry count_move_out = false in WelcomeHome')),
  supported_dimensions = ARRAY['community','date'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.move_outs';

-- wh.net_move_ins
UPDATE public.metric_definitions SET
  description = 'Move-ins less move-outs for the selected period.',
  source_table = 'wh_housing_contracts',
  date_field = 'financial_move_in_date / financial_move_out_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_housing_contracts'),
    'rule','wh.move_ins (v1) - wh.move_outs (v1) over the same period and community scope',
    'depends_on', jsonb_build_array('wh.move_ins@1','wh.move_outs@1')),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','inherits every wh.move_ins and wh.move_outs exclusion')),
  supported_dimensions = ARRAY['community','date'],
  metric_version = 1, status = 'validated', validation_status = 'validated'
WHERE metric_key = 'wh.net_move_ins';

-- wh.deposits (stays provisional)
UPDATE public.metric_definitions SET
  description = 'Distinct depositors with a standard deposit transaction dated in the period. PROVISIONAL — a known WelcomeHome API limitation prevents full reconciliation to the official Depositor List.',
  source_table = 'wh_deposit_transactions',
  date_field = 'occurred_local_date',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_deposit_transactions'),
    'date_field','occurred_local_date (source calendar date, no timezone shift)',
    'rule','COUNT(DISTINCT depositor) WHERE transaction_type = Deposit AND deposit_type = Deposit AND amount > 0 AND occurred_local_date in period',
    'drill_through','public.wh_deposit_page'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','refunds excluded (retained as diagnostics)'),
    jsonb_build_object('rule','waitlist deposits excluded (retained)'),
    jsonb_build_object('rule','zero-amount stage-advance rows excluded (retained as diagnostics)'),
    jsonb_build_object('rule','discarded transactions excluded'),
    jsonb_build_object('rule','a depositor is never counted twice in a period')),
  supported_dimensions = ARRAY['community','date'],
  metric_version = 1, status = 'provisional', validation_status = 'in_review'
WHERE metric_key = 'wh.deposits';

-- wh.occupancy_pct (current state only)
UPDATE public.metric_definitions SET
  description = 'Occupied census-eligible units as a percentage of census-eligible units. CURRENT STATE ONLY — the current formula is reconciled, but historical as-of-date occupancy is unavailable until WelcomeHome Daily Snapshots are ingested.',
  source_table = 'wh_units',
  date_field = NULL,
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'source_tables', jsonb_build_array('wh_units','wh_housing_contracts'),
    'rule','occupied census-eligible units / census-eligible units, evaluated against current source state',
    'census_rule','public.wh_unit_census_exclusion — configurable, case-insensitive, whitespace-normalized exact matching on unit_number, unit_name and floor_plan_label',
    'temporal_scope','current state; NOT filtered by the selected date range',
    'historical','unavailable — requires WelcomeHome Daily Snapshots; never reconstructed from present-state rows'),
  exclusion_rules = jsonb_build_array(
    jsonb_build_object('rule','explicit off-census units excluded'),
    jsonb_build_object('rule','inactive/discarded units excluded'),
    jsonb_build_object('rule','recognized pseudo-units (e.g. WAITLIST) excluded via configurable pattern list'),
    jsonb_build_object('rule','no community-specific hard-coded denominator')),
  supported_dimensions = ARRAY['community'],
  metric_version = 1, status = 'provisional', validation_status = 'in_review'
WHERE metric_key = 'wh.occupancy_pct';

-- wh.projected_occupancy_pct
UPDATE public.metric_definitions SET
  description = 'Occupancy projected from known future move-ins and move-outs. PROVISIONAL — not reconciled against any official WelcomeHome report.',
  source_table = 'wh_housing_contracts',
  calculation_definition = jsonb_build_object(
    'engine','public.wh_sales_summary',
    'rule','current occupied census units adjusted by future-dated contract move-ins and move-outs',
    'limitation','no official comparison report exists; unvalidated'),
  supported_dimensions = ARRAY['community'],
  metric_version = 1, status = 'provisional', validation_status = 'unvalidated'
WHERE metric_key = 'wh.projected_occupancy_pct';