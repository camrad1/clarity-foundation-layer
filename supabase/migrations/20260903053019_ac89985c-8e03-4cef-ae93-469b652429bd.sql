CREATE TABLE public.occupancy_history_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'official_daily_backfill',
  source_file_name text NOT NULL,
  source_sheet_name text,
  source_year integer,
  source_range_start date,
  source_range_end date,
  cutoff_date date NOT NULL,
  records_imported integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  future_rows_skipped integer NOT NULL DEFAULT 0,
  unmapped_communities text[] NOT NULL DEFAULT '{}',
  communities_imported integer NOT NULL DEFAULT 0,
  validation_warnings integer NOT NULL DEFAULT 0,
  mapping_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.occupancy_history_community_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_community_name text NOT NULL,
  normalized_name text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  ignored boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_name)
);

CREATE TABLE public.community_daily_occupancy_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  occupancy_date date NOT NULL,
  source_type text NOT NULL DEFAULT 'official_daily_backfill',
  beginning_occupied_units numeric(10,2),
  move_ins numeric(10,2),
  move_outs numeric(10,2),
  net_move_ins_move_outs numeric(10,2),
  ending_occupied_units numeric(10,2),
  beginning_occupancy_pct numeric(8,6),
  ending_occupancy_pct numeric(8,6),
  total_units numeric(10,2),
  raw_source_community_name text,
  raw_source_date_label text,
  validation_status text NOT NULL DEFAULT 'ok',
  notes text,
  source_file_name text,
  source_sheet_name text,
  import_batch_id uuid REFERENCES public.occupancy_history_import_batches(id) ON DELETE SET NULL,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, community_id, occupancy_date, source_type)
);

CREATE INDEX idx_cdoh_scope_date ON public.community_daily_occupancy_history (organization_id, community_id, occupancy_date);
CREATE INDEX idx_cdoh_batch ON public.community_daily_occupancy_history (import_batch_id);

GRANT SELECT ON public.community_daily_occupancy_history TO authenticated;
GRANT SELECT ON public.occupancy_history_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occupancy_history_community_mappings TO authenticated;
GRANT ALL ON public.community_daily_occupancy_history TO service_role;
GRANT ALL ON public.occupancy_history_import_batches TO service_role;
GRANT ALL ON public.occupancy_history_community_mappings TO service_role;

ALTER TABLE public.community_daily_occupancy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupancy_history_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupancy_history_community_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "History readable by community members"
  ON public.community_daily_occupancy_history FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));

CREATE POLICY "Batches readable by org members"
  ON public.occupancy_history_import_batches FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE POLICY "Mappings readable by org members"
  ON public.occupancy_history_community_mappings FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE POLICY "Mappings managed by org admins"
  ON public.occupancy_history_community_mappings FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

CREATE TRIGGER trg_occ_history_mappings_updated
  BEFORE UPDATE ON public.occupancy_history_community_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.data_source_types (key, name, category, supports_api, supports_manual_upload)
VALUES ('official_daily_backfill', 'Official Daily Occupancy History', 'occupancy', false, true)
ON CONFLICT (key) DO NOTHING;