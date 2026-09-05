CREATE TABLE public.google_backfill_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.google_connections(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('search_console','ga4')),
  property_id text NOT NULL,
  grain text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  rows_written bigint NOT NULL DEFAULT 0,
  pages integer NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, property_id, grain, period_start)
);
GRANT SELECT ON public.google_backfill_chunks TO authenticated;
GRANT ALL ON public.google_backfill_chunks TO service_role;
ALTER TABLE public.google_backfill_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Import managers read google backfill chunks"
ON public.google_backfill_chunks FOR SELECT TO authenticated
USING (public.can_manage_imports(organization_id));
CREATE INDEX google_backfill_chunks_queue ON public.google_backfill_chunks (organization_id, service, status, period_start DESC);

INSERT INTO private.cron_tokens (name, token)
VALUES ('google_backfill', encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;