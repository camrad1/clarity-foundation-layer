-- =========================================================
-- ClarityIQ Phase 2 — WelcomeHome ingestion foundation
-- =========================================================

-- 0. Secure credential material (service-role only table; no policies)
ALTER TABLE public.data_source_credentials
  ADD COLUMN IF NOT EXISTS secret_value text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verification_error text;

-- Register the WelcomeHome source type
INSERT INTO public.data_source_types (key, name, category, supports_api, supports_manual_upload)
VALUES ('welcomehome', 'WelcomeHome CRM', 'crm', true, false)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, category = EXCLUDED.category, supports_api = EXCLUDED.supports_api;

-- Enum for semantic activity categories
DO $$ BEGIN
  CREATE TYPE public.wh_activity_category AS ENUM
    ('tour','re_tour','call','email','outreach','appointment','other','unmapped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wh_score_level AS ENUM ('hot','warm','cold','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wh_sync_mode AS ENUM ('full','incremental');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 1. Discovered WelcomeHome communities
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_source_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
GRANT SELECT ON public.wh_source_communities TO authenticated;
GRANT ALL ON public.wh_source_communities TO service_role;
ALTER TABLE public.wh_source_communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_source_communities_select" ON public.wh_source_communities
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_wh_source_communities BEFORE UPDATE ON public.wh_source_communities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 2. Lookup dimensions (generic, preserves source id + label)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  lookup_type text NOT NULL,
  source_id text NOT NULL,
  label text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_community_id text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, lookup_type, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_lookups_org_type ON public.wh_lookups (organization_id, lookup_type);
GRANT SELECT ON public.wh_lookups TO authenticated;
GRANT ALL ON public.wh_lookups TO service_role;
ALTER TABLE public.wh_lookups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_lookups_select" ON public.wh_lookups
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_wh_lookups BEFORE UPDATE ON public.wh_lookups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 3. Prospects
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  account_id text,
  status text,
  stage_id text,
  score_id text,
  lead_source_id text,
  secondary_lead_source_id text,
  referrer_id text,
  active_at timestamptz,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  initial_contact_at timestamptz,
  last_contact_at timestamptz,
  status_changed_at timestamptz,
  next_activity_scheduled_at timestamptz,
  expected_move_timing_id text,
  original_sales_counselor_id text,
  current_sales_counselor_id text,
  close_reason_id text,
  merged_into_prospect_id text,
  discarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_prospects_org_comm ON public.wh_prospects (organization_id, community_id);
CREATE INDEX IF NOT EXISTS ix_wh_prospects_updated ON public.wh_prospects (connection_id, updated_at_source);
GRANT SELECT ON public.wh_prospects TO authenticated;
GRANT ALL ON public.wh_prospects TO service_role;
ALTER TABLE public.wh_prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_prospects_select" ON public.wh_prospects
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL
              OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_prospects BEFORE UPDATE ON public.wh_prospects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 4. Activities
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  record_type text,
  record_id text,
  prospect_source_id text,
  activity_type_id text,
  result_id text,
  direction text,
  stage_id text,
  user_id_source text,
  completed_successfully boolean,
  scheduled_at timestamptz,
  completed_at timestamptz,
  completed_local_date date,
  scheduled_local_date date,
  source_timezone text,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  discarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_activities_org_date ON public.wh_activities (organization_id, completed_local_date);
CREATE INDEX IF NOT EXISTS ix_wh_activities_prospect ON public.wh_activities (connection_id, prospect_source_id);
CREATE INDEX IF NOT EXISTS ix_wh_activities_updated ON public.wh_activities (connection_id, updated_at_source);
GRANT SELECT ON public.wh_activities TO authenticated;
GRANT ALL ON public.wh_activities TO service_role;
ALTER TABLE public.wh_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_activities_select" ON public.wh_activities
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_activities BEFORE UPDATE ON public.wh_activities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 5. Housing contracts
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_housing_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  prospect_source_id text,
  resident_source_id text,
  unit_source_id text,
  status text,
  contract_type text,
  stay_type text,
  privacy_level_id text,
  care_type_id_source text,
  move_in_date date,
  financial_move_in_date date,
  move_out_date date,
  financial_move_out_date date,
  notice_date date,
  count_move_in boolean,
  count_move_out boolean,
  is_transfer boolean,
  move_out_reason_id text,
  occupancy_point_factor numeric,
  monthly_rate numeric,
  care_rate numeric,
  community_fee numeric,
  concessions numeric,
  deposit_amount numeric,
  deposit_received_at timestamptz,
  deposit_received_date date,
  sales_counselor_id text,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  discarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_contracts_org_mi ON public.wh_housing_contracts (organization_id, move_in_date);
CREATE INDEX IF NOT EXISTS ix_wh_contracts_org_mo ON public.wh_housing_contracts (organization_id, move_out_date);
CREATE INDEX IF NOT EXISTS ix_wh_contracts_updated ON public.wh_housing_contracts (connection_id, updated_at_source);
GRANT SELECT ON public.wh_housing_contracts TO authenticated;
GRANT ALL ON public.wh_housing_contracts TO service_role;
ALTER TABLE public.wh_housing_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_housing_contracts_select" ON public.wh_housing_contracts
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_housing_contracts BEFORE UPDATE ON public.wh_housing_contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 6. Units
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  unit_number text,
  unit_name text,
  floor text,
  care_type_id_source text,
  floor_plan_id text,
  privacy_level_id text,
  square_feet numeric,
  market_rate numeric,
  off_census boolean,
  status text,
  occupancy_point_factor numeric,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  discarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_units_org_comm ON public.wh_units (organization_id, community_id);
GRANT SELECT ON public.wh_units TO authenticated;
GRANT ALL ON public.wh_units TO service_role;
ALTER TABLE public.wh_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_units_select" ON public.wh_units
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_units BEFORE UPDATE ON public.wh_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 7. Marketing touchpoints
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_marketing_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  prospect_source_id text,
  lead_source_id text,
  campaign_name text,
  occurred_at timestamptz,
  occurred_local_date date,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_touchpoints_prospect ON public.wh_marketing_touchpoints (connection_id, prospect_source_id);
GRANT SELECT ON public.wh_marketing_touchpoints TO authenticated;
GRANT ALL ON public.wh_marketing_touchpoints TO service_role;
ALTER TABLE public.wh_marketing_touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_touchpoints_select" ON public.wh_marketing_touchpoints
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_touchpoints BEFORE UPDATE ON public.wh_marketing_touchpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 8. Deposit transactions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_deposit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  prospect_source_id text,
  housing_contract_source_id text,
  transaction_type text,
  amount numeric,
  occurred_at timestamptz,
  occurred_local_date date,
  refunded_at timestamptz,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  discarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_wh_deposits_org_date ON public.wh_deposit_transactions (organization_id, occurred_local_date);
GRANT SELECT ON public.wh_deposit_transactions TO authenticated;
GRANT ALL ON public.wh_deposit_transactions TO service_role;
ALTER TABLE public.wh_deposit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_deposits_select" ON public.wh_deposit_transactions
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_wh_deposits BEFORE UPDATE ON public.wh_deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 9. Per-table sync state and per-run detail
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  watermark timestamptz,
  source_max_updated_at timestamptz,
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  last_mode public.wh_sync_mode,
  rows_received integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  rows_unmapped integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error_summary text,
  warnings text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_table)
);
GRANT SELECT ON public.wh_sync_state TO authenticated;
GRANT ALL ON public.wh_sync_state TO service_role;
ALTER TABLE public.wh_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_sync_state_select" ON public.wh_sync_state
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_wh_sync_state BEFORE UPDATE ON public.wh_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.wh_sync_table_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  mode public.wh_sync_mode NOT NULL,
  status text NOT NULL DEFAULT 'running',
  requested_after timestamptz,
  rows_received integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  rows_unmapped integer NOT NULL DEFAULT 0,
  raw_rows_stored integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  source_max_updated_at timestamptz,
  duration_ms integer,
  error_summary text,
  warnings text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_wh_table_runs_run ON public.wh_sync_table_runs (sync_run_id);
GRANT SELECT ON public.wh_sync_table_runs TO authenticated;
GRANT ALL ON public.wh_sync_table_runs TO service_role;
ALTER TABLE public.wh_sync_table_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_sync_table_runs_select" ON public.wh_sync_table_runs
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));

-- =========================================================
-- 10. Semantic mapping configuration
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_activity_type_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  activity_type_id text NOT NULL,
  activity_type_label text,
  category public.wh_activity_category NOT NULL DEFAULT 'unmapped',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, activity_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wh_activity_type_mappings TO authenticated;
GRANT ALL ON public.wh_activity_type_mappings TO service_role;
ALTER TABLE public.wh_activity_type_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_atm_select" ON public.wh_activity_type_mappings
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "wh_atm_manage" ON public.wh_activity_type_mappings
  FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));
CREATE TRIGGER t_wh_atm BEFORE UPDATE ON public.wh_activity_type_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.wh_score_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  score_id text NOT NULL,
  score_label text,
  level public.wh_score_level NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, score_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wh_score_mappings TO authenticated;
GRANT ALL ON public.wh_score_mappings TO service_role;
ALTER TABLE public.wh_score_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_score_select" ON public.wh_score_mappings
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "wh_score_manage" ON public.wh_score_mappings
  FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));
CREATE TRIGGER t_wh_score BEFORE UPDATE ON public.wh_score_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 11. Provisional definition settings (per organization)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wh_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  inquiry_date_field text NOT NULL DEFAULT 'created_at_source',
  move_in_date_field text NOT NULL DEFAULT 'move_in_date',
  move_out_date_field text NOT NULL DEFAULT 'move_out_date',
  deposit_source text NOT NULL DEFAULT 'deposit_transactions',
  stalled_threshold_days integer NOT NULL DEFAULT 14,
  hot_no_activity_mode text NOT NULL DEFAULT 'none_scheduled',
  exclude_merged_prospects boolean NOT NULL DEFAULT true,
  exclude_discarded_prospects boolean NOT NULL DEFAULT true,
  incremental_overlap_minutes integer NOT NULL DEFAULT 120,
  daily_snapshots_state text NOT NULL DEFAULT 'not_configured',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.wh_settings TO authenticated;
GRANT ALL ON public.wh_settings TO service_role;
ALTER TABLE public.wh_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_settings_select" ON public.wh_settings
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "wh_settings_manage" ON public.wh_settings
  FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));
CREATE TRIGGER t_wh_settings BEFORE UPDATE ON public.wh_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();