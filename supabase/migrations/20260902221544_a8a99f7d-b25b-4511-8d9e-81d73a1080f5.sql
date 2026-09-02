CREATE TABLE public.wh_residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  source_community_id text,
  prospect_source_id text,
  person_source_id text,
  care_type_label text,
  current_residence text,
  first_resident boolean,
  marital_status text,
  veteran_status text,
  marked_deceased_at timestamptz,
  yardi_code text,
  yardi_id text,
  yardi_p_code text,
  discarded_at timestamptz,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);

GRANT SELECT ON public.wh_residents TO authenticated;
GRANT ALL ON public.wh_residents TO service_role;

ALTER TABLE public.wh_residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY wh_residents_select ON public.wh_residents
FOR SELECT TO authenticated
USING (has_org_access(organization_id) AND (community_id IS NULL OR has_community_access(community_id)));

CREATE INDEX wh_residents_org_community_idx ON public.wh_residents (organization_id, community_id);
CREATE INDEX wh_residents_prospect_idx ON public.wh_residents (connection_id, prospect_source_id);

CREATE TRIGGER wh_residents_touch_updated_at
BEFORE UPDATE ON public.wh_residents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();