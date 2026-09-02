
CREATE TABLE public.flash_occupancy_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  effective_start date NOT NULL,
  effective_end date,
  budget_occupied_units integer,
  budget_occupancy_pct numeric,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (budget_occupied_units IS NOT NULL OR budget_occupancy_pct IS NOT NULL),
  CHECK (effective_end IS NULL OR effective_end >= effective_start)
);
CREATE INDEX flash_budgets_scope_idx ON public.flash_occupancy_budgets (community_id, effective_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flash_occupancy_budgets TO authenticated;
GRANT ALL ON public.flash_occupancy_budgets TO service_role;
ALTER TABLE public.flash_occupancy_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flash_budgets_read" ON public.flash_occupancy_budgets
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));
CREATE POLICY "flash_budgets_write" ON public.flash_occupancy_budgets
  FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

CREATE TABLE public.flash_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  kind text NOT NULL DEFAULT 'networking',
  title text NOT NULL,
  target_audience text,
  invited_count integer,
  attended_count integer,
  notes text,
  reporting_month date,
  reporting_week_start date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('event','networking','referral','outreach','note','other'))
);
CREATE INDEX flash_manual_entries_scope_idx ON public.flash_manual_entries (community_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flash_manual_entries TO authenticated;
GRANT ALL ON public.flash_manual_entries TO service_role;
ALTER TABLE public.flash_manual_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flash_entries_read" ON public.flash_manual_entries
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));
CREATE POLICY "flash_entries_insert" ON public.flash_manual_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_access(organization_id)
              AND public.has_community_access(community_id)
              AND created_by = auth.uid());
CREATE POLICY "flash_entries_update" ON public.flash_manual_entries
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id) OR created_by = auth.uid())
  WITH CHECK (public.is_org_admin(organization_id) OR created_by = auth.uid());
CREATE POLICY "flash_entries_delete" ON public.flash_manual_entries
  FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id) OR created_by = auth.uid());

CREATE TABLE public.flash_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_key text NOT NULL,
  body text NOT NULL,
  reporting_month date,
  reporting_week_start date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_type IN ('hot_lead','move_in','move_out','deposit','notice','general'))
);
CREATE INDEX flash_notes_scope_idx ON public.flash_notes (community_id, subject_type, subject_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flash_notes TO authenticated;
GRANT ALL ON public.flash_notes TO service_role;
ALTER TABLE public.flash_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flash_notes_read" ON public.flash_notes
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));
CREATE POLICY "flash_notes_insert" ON public.flash_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_access(organization_id)
              AND public.has_community_access(community_id)
              AND created_by = auth.uid());
CREATE POLICY "flash_notes_update" ON public.flash_notes
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id) OR created_by = auth.uid())
  WITH CHECK (public.is_org_admin(organization_id) OR created_by = auth.uid());
CREATE POLICY "flash_notes_delete" ON public.flash_notes
  FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id) OR created_by = auth.uid());

CREATE TABLE public.flash_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.flash_notes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  community_id uuid NOT NULL,
  body text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flash_note_revisions_note_idx ON public.flash_note_revisions (note_id, edited_at DESC);

GRANT SELECT ON public.flash_note_revisions TO authenticated;
GRANT ALL ON public.flash_note_revisions TO service_role;
ALTER TABLE public.flash_note_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flash_note_revisions_read" ON public.flash_note_revisions
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));

CREATE OR REPLACE FUNCTION public.flash_note_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.flash_note_revisions (note_id, organization_id, community_id, body, edited_by)
  VALUES (NEW.id, NEW.organization_id, NEW.community_id, NEW.body, auth.uid());
  RETURN NEW;
END; $$;

CREATE TRIGGER flash_notes_audit_ins AFTER INSERT ON public.flash_notes
  FOR EACH ROW EXECUTE FUNCTION public.flash_note_audit();
CREATE TRIGGER flash_notes_audit_upd AFTER UPDATE OF body ON public.flash_notes
  FOR EACH ROW WHEN (OLD.body IS DISTINCT FROM NEW.body)
  EXECUTE FUNCTION public.flash_note_audit();

CREATE TRIGGER flash_budgets_touch BEFORE UPDATE ON public.flash_occupancy_budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER flash_entries_touch BEFORE UPDATE ON public.flash_manual_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER flash_notes_touch BEFORE UPDATE ON public.flash_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
