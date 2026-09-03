CREATE TABLE public.wh_nightly_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'queued',
  triggered_by text NOT NULL DEFAULT 'schedule',
  triggered_by_user uuid,
  communities_total int NOT NULL DEFAULT 0,
  communities_done int NOT NULL DEFAULT 0,
  communities_failed int NOT NULL DEFAULT 0,
  snapshots_written int NOT NULL DEFAULT 0,
  ticks int NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wh_nightly_runs_status_ck
    CHECK (status IN ('queued','running','success','partial','failed','canceled'))
);

-- At most one active nightly run per organization: a second scheduler tick or
-- a manual "Run now" joins the existing run instead of starting a parallel one.
CREATE UNIQUE INDEX wh_nightly_runs_active_uq
  ON public.wh_nightly_runs (organization_id)
  WHERE status IN ('queued','running');
CREATE INDEX wh_nightly_runs_org_date_idx ON public.wh_nightly_runs (organization_id, run_date DESC);

CREATE TABLE public.wh_nightly_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.wh_nightly_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE SET NULL,
  snapshot_date date,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, community_id),
  CONSTRAINT wh_nightly_units_status_ck
    CHECK (status IN ('pending','running','done','failed','skipped'))
);
CREATE INDEX wh_nightly_units_run_idx ON public.wh_nightly_units (run_id, status);

GRANT SELECT ON public.wh_nightly_runs TO authenticated;
GRANT ALL ON public.wh_nightly_runs TO service_role;
GRANT SELECT ON public.wh_nightly_units TO authenticated;
GRANT ALL ON public.wh_nightly_units TO service_role;

ALTER TABLE public.wh_nightly_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wh_nightly_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read nightly runs in own organization"
  ON public.wh_nightly_runs FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE POLICY "Read nightly units for authorized communities"
  ON public.wh_nightly_units FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));

CREATE TRIGGER wh_nightly_runs_touch BEFORE UPDATE ON public.wh_nightly_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER wh_nightly_units_touch BEFORE UPDATE ON public.wh_nightly_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- Single-flight lease. A worker may only process a run while it holds an
-- unexpired lease; a crashed worker's lease simply expires and the next
-- scheduled tick resumes the same run.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wh_nightly_claim(_run_id uuid, _lease_seconds int DEFAULT 300)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok uuid := gen_random_uuid();
BEGIN
  UPDATE public.wh_nightly_runs r
     SET lease_token = tok,
         lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
         status = 'running',
         started_at = COALESCE(r.started_at, now()),
         ticks = r.ticks + 1
   WHERE r.id = _run_id
     AND r.status IN ('queued','running')
     AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN tok;
END; $$;

/** Atomically claims the next pending community for a lease holder. */
CREATE OR REPLACE FUNCTION public.wh_nightly_claim_unit(_run_id uuid, _lease_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.wh_nightly_runs r
                  WHERE r.id = _run_id AND r.lease_token = _lease_token
                    AND r.lease_expires_at > now() AND r.status = 'running') THEN
    RETURN NULL;
  END IF;
  UPDATE public.wh_nightly_units u
     SET status = 'running', attempts = u.attempts + 1, started_at = now()
   WHERE u.id = (
     SELECT u2.id FROM public.wh_nightly_units u2
      WHERE u2.run_id = _run_id AND u2.status = 'pending'
      ORDER BY u2.created_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
   RETURNING u.id INTO uid;
  RETURN uid;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_nightly_release(_run_id uuid, _lease_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.wh_nightly_runs
     SET lease_token = NULL, lease_expires_at = NULL
   WHERE id = _run_id AND lease_token = _lease_token;
$$;

REVOKE ALL ON FUNCTION public.wh_nightly_claim(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_nightly_claim_unit(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_nightly_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wh_nightly_claim(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.wh_nightly_claim_unit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wh_nightly_release(uuid, uuid) TO service_role;