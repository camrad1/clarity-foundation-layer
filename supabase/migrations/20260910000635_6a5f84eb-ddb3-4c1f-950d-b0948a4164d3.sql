-- Harden secret/PII tables: no client-role access at all (server-only via service role).

REVOKE ALL ON TABLE public.data_source_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.google_oauth_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.google_oauth_states FROM anon, authenticated;
REVOKE ALL ON TABLE public.source_records_raw FROM anon, authenticated;

GRANT ALL ON TABLE public.data_source_credentials TO service_role;
GRANT ALL ON TABLE public.google_oauth_tokens TO service_role;
GRANT ALL ON TABLE public.google_oauth_states TO service_role;
GRANT ALL ON TABLE public.source_records_raw TO service_role;

ALTER TABLE public.data_source_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_records_raw ENABLE ROW LEVEL SECURITY;

-- Explicit deny-by-default policies so intent is documented, not implied by absence.
DROP POLICY IF EXISTS "credentials no client access" ON public.data_source_credentials;
CREATE POLICY "credentials no client access" ON public.data_source_credentials
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "oauth tokens no client access" ON public.google_oauth_tokens;
CREATE POLICY "oauth tokens no client access" ON public.google_oauth_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "oauth states no client access" ON public.google_oauth_states;
CREATE POLICY "oauth states no client access" ON public.google_oauth_states
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "raw source records no client access" ON public.source_records_raw;
CREATE POLICY "raw source records no client access" ON public.source_records_raw
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.data_source_credentials IS 'Server-only secret store. No client role has table privileges; writes go through org-admin guarded server functions (can_manage_imports).';
COMMENT ON TABLE public.google_oauth_tokens IS 'Server-only Google OAuth access/refresh tokens. No client role has table privileges.';
COMMENT ON TABLE public.google_oauth_states IS 'Server-only one-time OAuth state rows. No client role has table privileges.';
COMMENT ON TABLE public.source_records_raw IS 'Server-only raw ingested payloads (may contain PII). No client role has table privileges; dashboards read normalized org-scoped tables instead.';