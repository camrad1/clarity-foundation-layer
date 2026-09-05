CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('search_console','ga4')),
  status text NOT NULL DEFAULT 'disconnected',
  google_account_email text,
  granted_scopes text[],
  selected_property_id text,
  selected_property_name text,
  selected_property_type text,
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  latest_data_date date,
  rows_synced bigint NOT NULL DEFAULT 0,
  last_error text,
  connected_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Import managers manage google connections"
ON public.google_connections FOR ALL TO authenticated
USING (public.can_manage_imports(organization_id))
WITH CHECK (public.can_manage_imports(organization_id));

CREATE TRIGGER google_connections_set_updated_at
BEFORE UPDATE ON public.google_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.google_oauth_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.google_connections(id) ON DELETE CASCADE,
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  token_type text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.google_oauth_tokens TO service_role;
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.google_oauth_states (
  state text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('search_console','ga4')),
  redirect_uri text NOT NULL,
  return_path text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz
);

GRANT ALL ON public.google_oauth_states TO service_role;
ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;