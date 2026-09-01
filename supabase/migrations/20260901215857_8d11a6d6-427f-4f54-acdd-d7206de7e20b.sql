
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('platform_admin','organization_admin','regional_user','community_user','marketing_user','read_only');
CREATE TYPE public.entity_status AS ENUM ('active','inactive','archived','pending');
CREATE TYPE public.connection_status AS ENUM ('connected','needs_attention','disconnected','manual_upload','syncing');
CREATE TYPE public.metric_status AS ENUM ('draft','provisional','validated','deprecated');
CREATE TYPE public.metric_validation_state AS ENUM ('unvalidated','in_review','validated','failed');
CREATE TYPE public.validation_check_status AS ENUM ('pending','matched','mismatch','approved','needs_review');
CREATE TYPE public.sync_run_status AS ENUM ('running','success','partial','failed');
CREATE TYPE public.url_match_type AS ENUM ('exact_url','url_contains','path_prefix','regex');
CREATE TYPE public.attribution_level AS ENUM ('exact','joined','aggregate');

-- ============ SHARED ============
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ ORGANIZATIONS ============
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status public.entity_status NOT NULL DEFAULT 'active',
  default_timezone text NOT NULL DEFAULT 'America/Chicago',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'read_only',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_memberships TO authenticated;
GRANT ALL ON public.organization_memberships TO service_role;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

-- ============ SECURITY DEFINER ACCESS HELPERS ============
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.role = 'platform_admin');
$$;

CREATE OR REPLACE FUNCTION public.has_org_access(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.organization_id = _org_id);
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.organization_id = _org_id
                   AND m.role = 'organization_admin');
$$;

CREATE OR REPLACE FUNCTION public.has_org_wide_scope(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.organization_id = _org_id
                   AND m.role IN ('organization_admin','marketing_user','read_only'));
$$;

-- ============ REGIONS ============
CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  parent_region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regions TO authenticated;
GRANT ALL ON public.regions TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

-- ============ COMMUNITIES ============
CREATE TABLE public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  status public.entity_status NOT NULL DEFAULT 'active',
  city text,
  state text,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  website_url text,
  primary_domain text,
  unit_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communities TO authenticated;
GRANT ALL ON public.communities TO service_role;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;

-- ============ USER SCOPING ============
CREATE TABLE public.user_community_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, community_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_community_access TO authenticated;
GRANT ALL ON public.user_community_access TO service_role;
ALTER TABLE public.user_community_access ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_region_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, region_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_region_access TO authenticated;
GRANT ALL ON public.user_region_access TO service_role;
ALTER TABLE public.user_region_access ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_community_access(_community_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.communities c
    WHERE c.id = _community_id
      AND (
        public.has_org_wide_scope(c.organization_id, _user_id)
        OR EXISTS (SELECT 1 FROM public.user_community_access a
                   WHERE a.user_id = _user_id AND a.community_id = c.id)
        OR (c.region_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_region_access r
              WHERE r.user_id = _user_id AND r.region_id = c.region_id))
      )
  );
$$;

-- ============ CARE TYPES ============
CREATE TABLE public.care_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX care_types_org_slug_idx ON public.care_types (COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid), slug);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.care_types TO authenticated;
GRANT ALL ON public.care_types TO service_role;
ALTER TABLE public.care_types ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.community_care_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  care_type_id uuid NOT NULL REFERENCES public.care_types(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, care_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_care_types TO authenticated;
GRANT ALL ON public.community_care_types TO service_role;
ALTER TABLE public.community_care_types ENABLE ROW LEVEL SECURITY;

-- ============ DATA SOURCES ============
CREATE TABLE public.data_source_types (
  key text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  supports_api boolean NOT NULL DEFAULT false,
  supports_manual_upload boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.data_source_types TO authenticated;
GRANT ALL ON public.data_source_types TO service_role;
ALTER TABLE public.data_source_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "data source types readable by authenticated" ON public.data_source_types FOR SELECT TO authenticated USING (true);
INSERT INTO public.data_source_types (key, name, category, supports_api, supports_manual_upload) VALUES
  ('search_console','Google Search Console','marketing', true, true),
  ('welcomehome','WelcomeHome CRM','crm', true, false),
  ('further','Further','conversational', false, true);

CREATE TABLE public.data_source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL REFERENCES public.data_source_types(key),
  display_name text NOT NULL,
  status public.connection_status NOT NULL DEFAULT 'disconnected',
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  data_through_date date,
  connection_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_source_connections TO authenticated;
GRANT ALL ON public.data_source_connections TO service_role;
ALTER TABLE public.data_source_connections ENABLE ROW LEVEL SECURITY;

-- Credential references: never readable by app users. service_role only.
CREATE TABLE public.data_source_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  secret_ref text NOT NULL,
  credential_kind text NOT NULL DEFAULT 'api_token',
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.data_source_credentials TO service_role;
ALTER TABLE public.data_source_credentials ENABLE ROW LEVEL SECURITY;
-- intentionally NO policies and NO grants for anon/authenticated

-- ============ MAPPINGS ============
CREATE TABLE public.community_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  source_type text NOT NULL REFERENCES public.data_source_types(key),
  external_id text NOT NULL,
  external_name text,
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_source_mappings TO authenticated;
GRANT ALL ON public.community_source_mappings TO service_role;
ALTER TABLE public.community_source_mappings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.url_mapping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  match_type public.url_match_type NOT NULL,
  pattern text NOT NULL,
  content_type text NOT NULL DEFAULT 'other',
  intent_type text,
  topic text,
  care_type_id uuid REFERENCES public.care_types(id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.url_mapping_rules TO authenticated;
GRANT ALL ON public.url_mapping_rules TO service_role;
ALTER TABLE public.url_mapping_rules ENABLE ROW LEVEL SECURITY;

-- ============ METRIC REGISTRY ============
CREATE TABLE public.metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  name text NOT NULL,
  description text,
  source_type text REFERENCES public.data_source_types(key),
  source_table text,
  date_field text,
  calculation_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  supported_dimensions text[] NOT NULL DEFAULT ARRAY['community','date'],
  metric_version integer NOT NULL DEFAULT 1,
  status public.metric_status NOT NULL DEFAULT 'draft',
  validation_status public.metric_validation_state NOT NULL DEFAULT 'unvalidated',
  supersedes_id uuid REFERENCES public.metric_definitions(id) ON DELETE SET NULL,
  effective_start date NOT NULL DEFAULT CURRENT_DATE,
  effective_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX metric_definitions_key_version_idx ON public.metric_definitions
  (COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid), metric_key, metric_version);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_definitions TO authenticated;
GRANT ALL ON public.metric_definitions TO service_role;
ALTER TABLE public.metric_definitions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.metric_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  target_value numeric NOT NULL,
  effective_start date NOT NULL,
  effective_end date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_goals TO authenticated;
GRANT ALL ON public.metric_goals TO service_role;
ALTER TABLE public.metric_goals ENABLE ROW LEVEL SECURITY;

-- Deterministic metric results with drill-through references
CREATE TABLE public.metric_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  metric_definition_id uuid NOT NULL REFERENCES public.metric_definitions(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_version integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  value numeric,
  record_count integer,
  drill_through_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_sync_run_id uuid,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.metric_results TO authenticated;
GRANT ALL ON public.metric_results TO service_role;
ALTER TABLE public.metric_results ENABLE ROW LEVEL SECURITY;

-- ============ SYNC / RAW SOURCE ============
CREATE TABLE public.source_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status public.sync_run_status NOT NULL DEFAULT 'running',
  records_received integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  error_summary text,
  sync_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.source_sync_runs TO authenticated;
GRANT ALL ON public.source_sync_runs TO service_role;
ALTER TABLE public.source_sync_runs ENABLE ROW LEVEL SECURITY;

-- Raw staging: no client grants (may contain PII). Server-side access only.
CREATE TABLE public.source_records_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE SET NULL,
  source_type text NOT NULL REFERENCES public.data_source_types(key),
  record_type text NOT NULL,
  source_record_id text NOT NULL,
  source_community_external_id text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  merged_into_source_id text,
  is_discarded boolean NOT NULL DEFAULT false,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  contains_pii boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, record_type, source_record_id)
);
GRANT ALL ON public.source_records_raw TO service_role;
ALTER TABLE public.source_records_raw ENABLE ROW LEVEL SECURITY;
-- intentionally NO policies for authenticated: reached only via server functions

-- ============ SNAPSHOTS ============
CREATE TABLE public.community_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  snapshot_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, snapshot_date, snapshot_type)
);
GRANT SELECT ON public.community_daily_snapshots TO authenticated;
GRANT ALL ON public.community_daily_snapshots TO service_role;
ALTER TABLE public.community_daily_snapshots ENABLE ROW LEVEL SECURITY;

-- ============ VALIDATION CENTER ============
CREATE TABLE public.metric_validation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_version integer,
  period_start date NOT NULL,
  period_end date NOT NULL,
  calculated_value numeric,
  expected_value numeric,
  difference numeric GENERATED ALWAYS AS (calculated_value - expected_value) STORED,
  status public.validation_check_status NOT NULL DEFAULT 'pending',
  reviewer_notes text,
  reviewed_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_validation_checks TO authenticated;
GRANT ALL ON public.metric_validation_checks TO service_role;
ALTER TABLE public.metric_validation_checks ENABLE ROW LEVEL SECURITY;

-- ============ INSIGHTS / AI FOUNDATION ============
CREATE TABLE public.insight_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  metric_keys text[] NOT NULL DEFAULT '{}',
  supporting_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution_level public.attribution_level NOT NULL DEFAULT 'aggregate',
  period_start date,
  period_end date,
  data_freshness_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.insight_signals TO authenticated;
GRANT ALL ON public.insight_signals TO service_role;
ALTER TABLE public.insight_signals ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ai_insight_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  signal_ids uuid[] NOT NULL DEFAULT '{}',
  narrative text NOT NULL,
  model text,
  prompt_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_insight_narratives TO authenticated;
GRANT ALL ON public.ai_insight_narratives TO service_role;
ALTER TABLE public.ai_insight_narratives ENABLE ROW LEVEL SECURITY;

-- ============ POLICIES ============
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_platform_admin());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "orgs select" ON public.organizations FOR SELECT TO authenticated USING (public.has_org_access(id));
CREATE POLICY "orgs insert" ON public.organizations FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "orgs update" ON public.organizations FOR UPDATE TO authenticated USING (public.is_org_admin(id)) WITH CHECK (public.is_org_admin(id));
CREATE POLICY "orgs delete" ON public.organizations FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "memberships select" ON public.organization_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_admin(organization_id));
CREATE POLICY "memberships write" ON public.organization_memberships FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "regions select" ON public.regions FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "regions write" ON public.regions FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "communities select" ON public.communities FOR SELECT TO authenticated USING (public.has_community_access(id));
CREATE POLICY "communities write" ON public.communities FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "community access select" ON public.user_community_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_admin(organization_id));
CREATE POLICY "community access write" ON public.user_community_access FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "region access select" ON public.user_region_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_admin(organization_id));
CREATE POLICY "region access write" ON public.user_region_access FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "care types select" ON public.care_types FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.has_org_access(organization_id));
CREATE POLICY "care types write" ON public.care_types FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_admin(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_org_admin(organization_id));

CREATE POLICY "community care types select" ON public.community_care_types FOR SELECT TO authenticated
  USING (public.has_community_access(community_id));
CREATE POLICY "community care types write" ON public.community_care_types FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "connections select" ON public.data_source_connections FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "connections write" ON public.data_source_connections FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "mappings select" ON public.community_source_mappings FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "mappings write" ON public.community_source_mappings FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "url rules select" ON public.url_mapping_rules FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "url rules write" ON public.url_mapping_rules FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "metric defs select" ON public.metric_definitions FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.has_org_access(organization_id));
CREATE POLICY "metric defs org write" ON public.metric_definitions FOR ALL TO authenticated
  USING (CASE WHEN organization_id IS NULL THEN public.is_platform_admin() ELSE public.is_org_admin(organization_id) END)
  WITH CHECK (CASE WHEN organization_id IS NULL THEN public.is_platform_admin() ELSE public.is_org_admin(organization_id) END);

CREATE POLICY "goals select" ON public.metric_goals FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "goals write" ON public.metric_goals FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "metric results select" ON public.metric_results FOR SELECT TO authenticated
  USING (community_id IS NULL AND public.has_org_access(organization_id) OR community_id IS NOT NULL AND public.has_community_access(community_id));

CREATE POLICY "sync runs select" ON public.source_sync_runs FOR SELECT TO authenticated USING (public.has_org_access(organization_id));

CREATE POLICY "snapshots select" ON public.community_daily_snapshots FOR SELECT TO authenticated USING (public.has_community_access(community_id));

CREATE POLICY "validation select" ON public.metric_validation_checks FOR SELECT TO authenticated USING (public.is_org_admin(organization_id));
CREATE POLICY "validation write" ON public.metric_validation_checks FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "signals select" ON public.insight_signals FOR SELECT TO authenticated
  USING (community_id IS NULL AND public.has_org_access(organization_id) OR community_id IS NOT NULL AND public.has_community_access(community_id));

CREATE POLICY "narratives select" ON public.ai_insight_narratives FOR SELECT TO authenticated USING (public.has_org_access(organization_id));

-- ============ TRIGGERS ============
CREATE TRIGGER t_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_orgs BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_memberships BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_regions BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_communities BEFORE UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_care_types BEFORE UPDATE ON public.care_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_connections BEFORE UPDATE ON public.data_source_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_credentials BEFORE UPDATE ON public.data_source_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_csm BEFORE UPDATE ON public.community_source_mappings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_url BEFORE UPDATE ON public.url_mapping_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_metric_defs BEFORE UPDATE ON public.metric_definitions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_goals BEFORE UPDATE ON public.metric_goals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_raw BEFORE UPDATE ON public.source_records_raw FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_validation BEFORE UPDATE ON public.metric_validation_checks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Metric definition immutability guard: validated/deprecated definitions cannot be silently redefined
CREATE OR REPLACE FUNCTION public.guard_metric_definition_immutability() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('validated','deprecated')
     AND (NEW.calculation_definition IS DISTINCT FROM OLD.calculation_definition
       OR NEW.exclusion_rules IS DISTINCT FROM OLD.exclusion_rules
       OR NEW.date_field IS DISTINCT FROM OLD.date_field
       OR NEW.source_table IS DISTINCT FROM OLD.source_table)
     AND NEW.metric_version = OLD.metric_version THEN
    RAISE EXCEPTION 'Cannot change the calculation of a % metric in place. Create a new metric_version instead.', OLD.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_metric_immutable BEFORE UPDATE ON public.metric_definitions
FOR EACH ROW EXECUTE FUNCTION public.guard_metric_definition_immutability();

-- ============ PLATFORM METRIC REGISTRY SEED (definitions only, no calculation logic) ============
INSERT INTO public.metric_definitions (metric_key, name, source_type, status, validation_status, supported_dimensions, description) VALUES
 ('wh.new_inquiries','New Inquiries','welcomehome','draft','unvalidated',ARRAY['community','date','care_type'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.completed_tours','Completed Tours','welcomehome','draft','unvalidated',ARRAY['community','date','care_type'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.re_tours','Re-Tours','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.deposits','Deposits','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.move_ins','Move-Ins','welcomehome','draft','unvalidated',ARRAY['community','date','care_type'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.move_outs','Move-Outs','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.net_move_ins','Net Move-Ins','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Calculation pending WelcomeHome data.'),
 ('wh.occupancy_pct','Occupancy %','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Requires snapshot architecture.'),
 ('wh.projected_occupancy_pct','Projected Occupancy %','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Requires snapshot architecture.'),
 ('wh.lead_to_tour','Lead to Tour Conversion','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Cohort definition pending.'),
 ('wh.tour_to_deposit','Tour to Deposit Conversion','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Cohort definition pending.'),
 ('wh.lead_to_movein','Lead to Move-In Conversion','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Cohort definition pending.'),
 ('wh.hot_leads','Hot Leads','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Current-state metric.'),
 ('wh.hot_no_future_activity','Hot Leads Without Future Activity','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Current-state metric.'),
 ('wh.stalled_prospects','Stalled Prospects','welcomehome','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Current-state metric.'),
 ('gsc.clicks','Search Clicks','search_console','draft','unvalidated',ARRAY['community','date','page','query'],'Placeholder registry entry.'),
 ('gsc.impressions','Search Impressions','search_console','draft','unvalidated',ARRAY['community','date','page','query'],'Placeholder registry entry.'),
 ('gsc.ctr','Search CTR','search_console','draft','unvalidated',ARRAY['community','date','page','query'],'Placeholder registry entry.'),
 ('gsc.avg_position','Average Position','search_console','draft','unvalidated',ARRAY['community','date','query'],'Placeholder registry entry.'),
 ('gsc.local_intent_clicks','Local Intent Clicks','search_console','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Classification engine not built.'),
 ('gsc.branded_clicks','Branded Clicks','search_console','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Classification engine not built.'),
 ('gsc.informational_clicks','Informational Clicks','search_console','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry. Classification engine not built.'),
 ('further.conversations','Conversations','further','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry.'),
 ('further.move_ins','Attributed Move-Ins','further','draft','unvalidated',ARRAY['community','date'],'Placeholder registry entry.'),
 ('further.traffic_source_conversations','Conversations by Traffic Source','further','draft','unvalidated',ARRAY['community','date','traffic_source'],'Placeholder registry entry.');

-- Platform-level care type templates (organization-agnostic, editable per org)
INSERT INTO public.care_types (organization_id, name, slug, description) VALUES
 (NULL,'Independent Living','independent-living','Platform template care type.'),
 (NULL,'Assisted Living','assisted-living','Platform template care type.'),
 (NULL,'Memory Care','memory-care','Platform template care type.');

CREATE INDEX ON public.communities (organization_id);
CREATE INDEX ON public.community_source_mappings (community_id);
CREATE INDEX ON public.source_records_raw (organization_id, source_type, record_type);
CREATE INDEX ON public.metric_results (organization_id, metric_key, period_start);
CREATE INDEX ON public.organization_memberships (user_id);
