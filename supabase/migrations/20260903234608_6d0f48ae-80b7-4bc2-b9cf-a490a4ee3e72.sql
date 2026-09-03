-- Speeds up the per-row activity result lookup that runs on every Activities upsert.
CREATE INDEX IF NOT EXISTS ix_wh_lookups_org_type_label
  ON public.wh_lookups (organization_id, lookup_type, label);

-- Quarantine reason for records that could not be normalized or persisted.
ALTER TABLE public.source_records_raw
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

-- Resume checkpoint so a retried work unit continues from the last page that
-- was fully persisted instead of refetching every successful page.
ALTER TABLE public.wh_sync_state
  ADD COLUMN IF NOT EXISTS resume_cursor_url text,
  ADD COLUMN IF NOT EXISTS resume_pages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_updated_after timestamptz,
  ADD COLUMN IF NOT EXISTS resume_saved_at timestamptz;