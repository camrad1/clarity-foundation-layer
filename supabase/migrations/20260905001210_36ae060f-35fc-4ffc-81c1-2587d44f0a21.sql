-- ============================================================
-- FURTHER (talkfurther.com) canonical source layer.
-- Read-only analytics ingestion. All raw payloads preserved.
-- ============================================================

UPDATE public.data_source_types
   SET supports_api = true, category = 'conversational'
 WHERE key = 'further';

-- ---------- Further communities (discovery + mapping surface) ----------
CREATE TABLE IF NOT EXISTS public.further_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  further_community_id text NOT NULL,
  further_uuid text,
  name text,
  slug text,
  further_organization_id text,
  url text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, further_community_id)
);
GRANT SELECT ON public.further_communities TO authenticated;
GRANT ALL ON public.further_communities TO service_role;
ALTER TABLE public.further_communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_communities_select" ON public.further_communities
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_further_communities BEFORE UPDATE ON public.further_communities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Visitors ----------
CREATE TABLE IF NOT EXISTS public.further_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  visitor_uuid text NOT NULL,
  occurred_at timestamptz,
  further_community_id text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  referrer text,
  traffic_source text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, visitor_uuid)
);
CREATE INDEX IF NOT EXISTS ix_further_visitors_org_time ON public.further_visitors (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_further_visitors_community ON public.further_visitors (community_id);
GRANT SELECT ON public.further_visitors TO authenticated;
GRANT ALL ON public.further_visitors TO service_role;
ALTER TABLE public.further_visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_visitors_select" ON public.further_visitors
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_further_visitors BEFORE UPDATE ON public.further_visitors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Leads ----------
CREATE TABLE IF NOT EXISTS public.further_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  further_lead_id text NOT NULL,
  external_lead_id text,
  visitor_uuid text,
  further_community_id text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  created_on timestamptz,
  source_updated_at timestamptz,
  financially_unqualified boolean,
  move_in_date date,
  channel_source text,
  lead_submitted boolean,
  device text,
  traffic_source text,
  tours_count integer,
  tour_date timestamptz,
  tour_scheduled boolean,
  tour_confirmed boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, further_lead_id)
);
CREATE INDEX IF NOT EXISTS ix_further_leads_org_created ON public.further_leads (organization_id, created_on DESC);
CREATE INDEX IF NOT EXISTS ix_further_leads_external ON public.further_leads (organization_id, external_lead_id);
CREATE INDEX IF NOT EXISTS ix_further_leads_community ON public.further_leads (community_id);
GRANT SELECT ON public.further_leads TO authenticated;
GRANT ALL ON public.further_leads TO service_role;
ALTER TABLE public.further_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_leads_select" ON public.further_leads
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_further_leads BEFORE UPDATE ON public.further_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Lead details ----------
CREATE TABLE IF NOT EXISTS public.further_lead_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  further_lead_id text NOT NULL,
  external_lead_id text,
  visitor_uuid text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  score numeric,
  care_type text,
  traffic_source text,
  hash_code text,
  url_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail_fetched_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, further_lead_id)
);
GRANT SELECT ON public.further_lead_details TO authenticated;
GRANT ALL ON public.further_lead_details TO service_role;
ALTER TABLE public.further_lead_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_lead_details_select" ON public.further_lead_details
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_further_lead_details BEFORE UPDATE ON public.further_lead_details
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Conversation timeline events ----------
CREATE TABLE IF NOT EXISTS public.further_conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  further_lead_id text NOT NULL,
  event_key text NOT NULL,
  message_type text,
  created_on timestamptz,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, further_lead_id, event_key)
);
CREATE INDEX IF NOT EXISTS ix_further_events_lead ON public.further_conversation_events (organization_id, further_lead_id, created_on);
GRANT SELECT ON public.further_conversation_events TO authenticated;
GRANT ALL ON public.further_conversation_events TO service_role;
ALTER TABLE public.further_conversation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_events_select" ON public.further_conversation_events
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id)
         AND (community_id IS NULL OR public.has_community_access(community_id)));
CREATE TRIGGER t_further_events BEFORE UPDATE ON public.further_conversation_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Further <-> WelcomeHome deterministic match evidence ----------
CREATE TABLE IF NOT EXISTS public.further_wh_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  further_lead_id text NOT NULL,
  further_external_lead_id text,
  wh_prospect_id text,
  wh_field text,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  match_method text NOT NULL,
  evidence_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  matched_at timestamptz,
  audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, further_lead_id, evidence_type)
);
CREATE INDEX IF NOT EXISTS ix_further_matches_org ON public.further_wh_matches (organization_id, is_active);
GRANT SELECT ON public.further_wh_matches TO authenticated;
GRANT ALL ON public.further_wh_matches TO service_role;
ALTER TABLE public.further_wh_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_wh_matches_select" ON public.further_wh_matches
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_further_matches BEFORE UPDATE ON public.further_wh_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Per-dataset sync state (high-water marks) ----------
CREATE TABLE IF NOT EXISTS public.further_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  dataset text NOT NULL,
  watermark timestamptz,
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  rows_received integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  rows_unmapped integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, dataset)
);
GRANT SELECT ON public.further_sync_state TO authenticated;
GRANT ALL ON public.further_sync_state TO service_role;
ALTER TABLE public.further_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_sync_state_select" ON public.further_sync_state
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE TRIGGER t_further_sync_state BEFORE UPDATE ON public.further_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Per-work-unit run detail ----------
CREATE TABLE IF NOT EXISTS public.further_sync_unit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE CASCADE,
  dataset text NOT NULL,
  unit_key text NOT NULL,
  mode text NOT NULL DEFAULT 'incremental',
  status text NOT NULL DEFAULT 'running',
  requested_after timestamptz,
  rows_received integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  rows_unmapped integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  source_max_updated_at timestamptz,
  duration_ms integer,
  error_summary text,
  warnings text[] NOT NULL DEFAULT '{}',
  last_progress_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_further_unit_runs_run ON public.further_sync_unit_runs (sync_run_id);
CREATE INDEX IF NOT EXISTS ix_further_unit_runs_org ON public.further_sync_unit_runs (organization_id, started_at DESC);
GRANT SELECT ON public.further_sync_unit_runs TO authenticated;
GRANT ALL ON public.further_sync_unit_runs TO service_role;
ALTER TABLE public.further_sync_unit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "further_unit_runs_select" ON public.further_sync_unit_runs
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));

-- ---------- Stalled work reaper (progress-based, mirrors WelcomeHome) ----------
CREATE OR REPLACE FUNCTION public.further_sync_reap_stalled(_org_id uuid, _stall_minutes integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  stalled_count integer := 0;
  finalized jsonb := '[]'::jsonb;
  r record;
BEGIN
  UPDATE public.further_sync_unit_runs u
     SET status = 'stalled',
         completed_at = now(),
         error_summary = COALESCE(u.error_summary,
           'No progress for ' || _stall_minutes || ' minutes; marked stalled.')
   WHERE u.organization_id = _org_id
     AND u.status IN ('running', 'pending')
     AND u.last_progress_at < now() - make_interval(mins => _stall_minutes);
  stalled_count := COALESCE((SELECT count(*) FROM public.further_sync_unit_runs u
    WHERE u.organization_id = _org_id AND u.status = 'stalled'
      AND u.completed_at > now() - interval '1 minute'), 0);

  FOR r IN
    SELECT s.id,
           count(*) FILTER (WHERE u.status = 'success') AS ok,
           count(*) FILTER (WHERE u.status IN ('failed','stalled','partial')) AS bad,
           count(*) FILTER (WHERE u.status IN ('running','pending')) AS live
      FROM public.source_sync_runs s
      LEFT JOIN public.further_sync_unit_runs u ON u.sync_run_id = s.id
     WHERE s.organization_id = _org_id
       AND s.status IN ('queued','running')
     GROUP BY s.id
  LOOP
    IF r.live = 0 THEN
      UPDATE public.source_sync_runs
         SET status = CASE WHEN r.ok > 0 THEN 'partial'::public.sync_run_status
                           ELSE 'failed'::public.sync_run_status END,
             completed_at = now()
       WHERE id = r.id;
      finalized := finalized || jsonb_build_object('run_id', r.id, 'successful', r.ok, 'failed_or_stalled', r.bad);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('stalled_units', stalled_count, 'finalized_runs', finalized);
END; $$;
REVOKE ALL ON FUNCTION public.further_sync_reap_stalled(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.further_sync_reap_stalled(uuid, integer) TO service_role;

-- ---------- Scheduler token for the Further hook ----------
INSERT INTO private.cron_tokens (name, token)
VALUES ('further_sync', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;