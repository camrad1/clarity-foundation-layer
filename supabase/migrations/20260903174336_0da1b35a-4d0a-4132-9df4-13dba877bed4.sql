
CREATE TABLE public.forecast_weekly_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  forecast_month date NOT NULL,
  forecast_date date NOT NULL,
  projected_move_ins integer,
  projected_move_outs integer,
  projected_net integer GENERATED ALWAYS AS (COALESCE(projected_move_ins,0) - COALESCE(projected_move_outs,0)) STORED,
  stretch_goal integer,
  notes text,
  historical_source_note text,
  source_type text NOT NULL DEFAULT 'manual',
  source_file_name text,
  import_batch_id uuid,
  entered_by uuid,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, community_id, forecast_date)
);
CREATE INDEX idx_forecast_entries_month ON public.forecast_weekly_entries (organization_id, forecast_month, community_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.forecast_weekly_entries TO authenticated;
GRANT ALL ON public.forecast_weekly_entries TO service_role;
ALTER TABLE public.forecast_weekly_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY forecast_entries_read ON public.forecast_weekly_entries FOR SELECT TO authenticated
  USING (has_org_access(organization_id) AND has_community_access(community_id));
CREATE POLICY forecast_entries_insert ON public.forecast_weekly_entries FOR INSERT TO authenticated
  WITH CHECK (has_org_access(organization_id) AND has_community_access(community_id) AND entered_by = auth.uid());
CREATE POLICY forecast_entries_update ON public.forecast_weekly_entries FOR UPDATE TO authenticated
  USING (has_org_access(organization_id) AND has_community_access(community_id))
  WITH CHECK (has_org_access(organization_id) AND has_community_access(community_id));
CREATE POLICY forecast_entries_delete ON public.forecast_weekly_entries FOR DELETE TO authenticated
  USING (is_org_admin(organization_id));

CREATE TABLE public.forecast_entry_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.forecast_weekly_entries(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  community_id uuid NOT NULL,
  forecast_date date NOT NULL,
  previous_move_ins integer,
  previous_move_outs integer,
  previous_stretch_goal integer,
  previous_notes text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  correction_reason text
);
CREATE INDEX idx_forecast_revisions_entry ON public.forecast_entry_revisions (entry_id, changed_at DESC);
GRANT SELECT ON public.forecast_entry_revisions TO authenticated;
GRANT ALL ON public.forecast_entry_revisions TO service_role;
ALTER TABLE public.forecast_entry_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_revisions_read ON public.forecast_entry_revisions FOR SELECT TO authenticated
  USING (has_org_access(organization_id) AND has_community_access(community_id));

CREATE OR REPLACE FUNCTION public.forecast_guard_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE week_end date;
BEGIN
  -- A weekly forecast becomes an immutable point-in-time record once its
  -- reporting week has ended. Only an organization admin may correct it.
  week_end := OLD.forecast_date + 6;
  IF week_end < current_date AND NOT public.is_org_admin(OLD.organization_id) THEN
    RAISE EXCEPTION 'Past weekly forecasts can only be corrected by an organization admin';
  END IF;

  IF NEW.projected_move_ins IS DISTINCT FROM OLD.projected_move_ins
     OR NEW.projected_move_outs IS DISTINCT FROM OLD.projected_move_outs
     OR NEW.stretch_goal IS DISTINCT FROM OLD.stretch_goal
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    INSERT INTO public.forecast_entry_revisions
      (entry_id, organization_id, community_id, forecast_date, previous_move_ins,
       previous_move_outs, previous_stretch_goal, previous_notes, changed_by)
    VALUES (OLD.id, OLD.organization_id, OLD.community_id, OLD.forecast_date,
            OLD.projected_move_ins, OLD.projected_move_outs, OLD.stretch_goal, OLD.notes, auth.uid());
  END IF;

  NEW.updated_at := now();
  NEW.organization_id := OLD.organization_id;
  NEW.community_id := OLD.community_id;
  NEW.forecast_date := OLD.forecast_date;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_forecast_guard_history
  BEFORE UPDATE ON public.forecast_weekly_entries
  FOR EACH ROW EXECUTE FUNCTION public.forecast_guard_history();

CREATE TABLE public.forecast_community_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_community_name text NOT NULL,
  normalized_name text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  ignored boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.forecast_community_mappings TO authenticated;
GRANT ALL ON public.forecast_community_mappings TO service_role;
ALTER TABLE public.forecast_community_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_mappings_read ON public.forecast_community_mappings FOR SELECT TO authenticated
  USING (has_org_access(organization_id));
CREATE POLICY forecast_mappings_write ON public.forecast_community_mappings FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id)) WITH CHECK (public.can_manage_imports(organization_id));

CREATE TABLE public.forecast_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_file_name text NOT NULL,
  source_sheet_name text,
  forecast_dates_detected integer NOT NULL DEFAULT 0,
  communities_detected integer NOT NULL DEFAULT 0,
  records_imported integer NOT NULL DEFAULT 0,
  notes_imported integer NOT NULL DEFAULT 0,
  ambiguous_cells integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  unmapped_communities text[] NOT NULL DEFAULT '{}',
  report jsonb,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.forecast_import_batches TO authenticated;
GRANT ALL ON public.forecast_import_batches TO service_role;
ALTER TABLE public.forecast_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_batches_read ON public.forecast_import_batches FOR SELECT TO authenticated
  USING (has_org_access(organization_id));

CREATE TABLE public.forecast_eom_source_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  forecast_month date NOT NULL,
  source_move_ins integer,
  source_move_outs integer,
  source_note text,
  source_file_name text,
  import_batch_id uuid REFERENCES public.forecast_import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, community_id, forecast_month)
);
GRANT SELECT ON public.forecast_eom_source_values TO authenticated;
GRANT ALL ON public.forecast_eom_source_values TO service_role;
ALTER TABLE public.forecast_eom_source_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_eom_source_read ON public.forecast_eom_source_values FOR SELECT TO authenticated
  USING (has_org_access(organization_id) AND has_community_access(community_id));

CREATE TRIGGER trg_forecast_mappings_touch BEFORE UPDATE ON public.forecast_community_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_forecast_eom_touch BEFORE UPDATE ON public.forecast_eom_source_values
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Validated month-end actuals per community. Predicates are copied verbatim
-- from the validated wh_flash_move_ins / wh_flash_move_outs definitions; no
-- new metric definition is introduced here.
CREATE OR REPLACE FUNCTION public.forecast_eom_actuals(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS TABLE(community_id uuid, move_ins bigint, move_outs bigint, net_move_ins bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; mif text; mof text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT COALESCE(x.move_in_date_field, 'move_in_date'), COALESCE(x.move_out_date_field, 'move_out_date')
    INTO mif, mof
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  RETURN QUERY
  WITH mi AS (
    SELECT hc.community_id AS cid, count(*) AS n
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
       AND (CASE WHEN mif = 'financial_move_in_date' THEN hc.financial_move_in_date ELSE hc.move_in_date END)
           BETWEEN _start AND _end
     GROUP BY hc.community_id
  ), mo AS (
    SELECT hc.community_id AS cid, count(*) AS n
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_out IS TRUE
       AND (CASE WHEN mof = 'financial_move_out_date' THEN hc.financial_move_out_date ELSE hc.move_out_date END)
           BETWEEN _start AND _end
     GROUP BY hc.community_id
  )
  SELECT c.id, COALESCE(mi.n,0), COALESCE(mo.n,0), COALESCE(mi.n,0) - COALESCE(mo.n,0)
    FROM public.communities c
    LEFT JOIN mi ON mi.cid = c.id
    LEFT JOIN mo ON mo.cid = c.id
   WHERE c.id = ANY(scope);
END; $$;

REVOKE ALL ON FUNCTION public.forecast_eom_actuals(uuid, date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forecast_eom_actuals(uuid, date, date, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.forecast_guard_history() FROM PUBLIC, anon, authenticated;
