-- Work-unit granularity: one source table x one mapped community.
ALTER TABLE public.wh_sync_table_runs
  ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_community_id text;

ALTER TABLE public.wh_sync_state
  ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS community_scope text NOT NULL DEFAULT '';

ALTER TABLE public.wh_sync_state
  DROP CONSTRAINT IF EXISTS wh_sync_state_connection_id_source_table_key;

ALTER TABLE public.wh_sync_state
  ADD CONSTRAINT wh_sync_state_conn_table_scope_key
  UNIQUE (connection_id, source_table, community_scope);

CREATE INDEX IF NOT EXISTS wh_sync_table_runs_run_community_idx
  ON public.wh_sync_table_runs (sync_run_id, community_id, source_table);

-- Parent run lifecycle states for orchestrated portfolio syncs.
ALTER TYPE public.sync_run_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.sync_run_status ADD VALUE IF NOT EXISTS 'canceled';