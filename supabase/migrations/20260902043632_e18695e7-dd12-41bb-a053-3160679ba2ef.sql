ALTER TYPE sync_run_status ADD VALUE IF NOT EXISTS 'unsupported';

ALTER TABLE public.wh_prospects
  ADD COLUMN IF NOT EXISTS inquiry_date date,
  ADD COLUMN IF NOT EXISTS expected_stay_type text,
  ADD COLUMN IF NOT EXISTS stage_label text,
  ADD COLUMN IF NOT EXISTS score_label text,
  ADD COLUMN IF NOT EXISTS lead_source_label text,
  ADD COLUMN IF NOT EXISTS lead_source_category text,
  ADD COLUMN IF NOT EXISTS close_reason_label text;

ALTER TABLE public.wh_activities
  ADD COLUMN IF NOT EXISTS activity_type_label text,
  ADD COLUMN IF NOT EXISTS result_label text,
  ADD COLUMN IF NOT EXISTS stage_label text,
  ADD COLUMN IF NOT EXISTS assigned_to_id text,
  ADD COLUMN IF NOT EXISTS created_by_id text,
  ADD COLUMN IF NOT EXISTS auto_performed boolean,
  ADD COLUMN IF NOT EXISTS first_completed_of_type boolean;

ALTER TABLE public.wh_housing_contracts
  ADD COLUMN IF NOT EXISTS care_type_label text,
  ADD COLUMN IF NOT EXISTS privacy_level_label text,
  ADD COLUMN IF NOT EXISTS move_out_reason_label text,
  ADD COLUMN IF NOT EXISTS resident_count integer,
  ADD COLUMN IF NOT EXISTS resident_source_ids text,
  ADD COLUMN IF NOT EXISTS unit_number text,
  ADD COLUMN IF NOT EXISTS leased_on date,
  ADD COLUMN IF NOT EXISTS lease_canceled_on date,
  ADD COLUMN IF NOT EXISTS community_fee_received_on date,
  ADD COLUMN IF NOT EXISTS financial_status text,
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS one_time_concession numeric,
  ADD COLUMN IF NOT EXISTS recurring_concession numeric;

ALTER TABLE public.wh_units
  ADD COLUMN IF NOT EXISTS care_type_label text,
  ADD COLUMN IF NOT EXISTS floor_plan_label text,
  ADD COLUMN IF NOT EXISTS floor_plan_occupancy_points numeric;

ALTER TABLE public.wh_deposit_transactions
  ADD COLUMN IF NOT EXISTS resident_source_id text,
  ADD COLUMN IF NOT EXISTS deposit_type_id text,
  ADD COLUMN IF NOT EXISTS is_refund boolean;

ALTER TABLE public.wh_marketing_touchpoints
  ADD COLUMN IF NOT EXISTS lead_source_label text,
  ADD COLUMN IF NOT EXISTS added_by_type text,
  ADD COLUMN IF NOT EXISTS locked boolean;