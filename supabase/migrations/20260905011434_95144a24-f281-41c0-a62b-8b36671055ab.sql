CREATE TABLE public.google_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.google_connections(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('search_console','ga4')),
  run_type text NOT NULL DEFAULT 'validation',
  status text NOT NULL DEFAULT 'running',
  property_id text,
  range_start date,
  range_end date,
  rows_written bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.google_sync_runs TO authenticated;
GRANT ALL ON public.google_sync_runs TO service_role;
ALTER TABLE public.google_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Import managers read google sync runs"
ON public.google_sync_runs FOR SELECT TO authenticated
USING (public.can_manage_imports(organization_id));
CREATE INDEX google_sync_runs_idx ON public.google_sync_runs (organization_id, service, started_at DESC);

CREATE TABLE public.gsc_api_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.google_connections(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'google_api',
  property_id text NOT NULL,
  grain text NOT NULL CHECK (grain IN ('date','query','page','query_page','device','country','search_appearance')),
  date date NOT NULL,
  query text,
  page text,
  device text,
  country text,
  search_appearance text,
  dim_key text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  sync_run_id uuid REFERENCES public.google_sync_runs(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, property_id, grain, date, dim_key)
);
GRANT SELECT ON public.gsc_api_facts TO authenticated;
GRANT ALL ON public.gsc_api_facts TO service_role;
ALTER TABLE public.gsc_api_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Import managers read gsc api facts"
ON public.gsc_api_facts FOR SELECT TO authenticated
USING (public.can_manage_imports(organization_id));
CREATE INDEX gsc_api_facts_lookup ON public.gsc_api_facts (organization_id, grain, date);
CREATE INDEX gsc_api_facts_page_idx ON public.gsc_api_facts (organization_id, grain, page);

CREATE TABLE public.ga4_api_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.google_connections(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'google_api',
  property_id text NOT NULL,
  report text NOT NULL CHECK (report IN ('daily_totals','source_medium','landing_page')),
  date date NOT NULL,
  session_source_medium text,
  landing_page_path text,
  dim_key text NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  active_users integer NOT NULL DEFAULT 0,
  new_users integer NOT NULL DEFAULT 0,
  engaged_sessions integer NOT NULL DEFAULT 0,
  screen_page_views integer NOT NULL DEFAULT 0,
  conversions numeric,
  mapped_community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  sync_run_id uuid REFERENCES public.google_sync_runs(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, property_id, report, date, dim_key)
);
GRANT SELECT ON public.ga4_api_facts TO authenticated;
GRANT ALL ON public.ga4_api_facts TO service_role;
ALTER TABLE public.ga4_api_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Import managers read ga4 api facts"
ON public.ga4_api_facts FOR SELECT TO authenticated
USING (public.can_manage_imports(organization_id));
CREATE INDEX ga4_api_facts_lookup ON public.ga4_api_facts (organization_id, report, date);