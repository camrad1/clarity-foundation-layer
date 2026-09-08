CREATE TABLE public.google_ads_campaign_community_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_ads_customer_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  canonical_community_id uuid REFERENCES public.communities(id) ON DELETE RESTRICT,
  mapping_method text NOT NULL DEFAULT 'explicit_campaign_id',
  is_active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_to date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_campaign_community_mappings_method_chk
    CHECK (mapping_method IN ('explicit_campaign_id','manual_override','unmapped_historical')),
  CONSTRAINT google_ads_campaign_community_mappings_unique
    UNIQUE (organization_id, google_ads_customer_id, campaign_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_ads_campaign_community_mappings TO authenticated;
GRANT ALL ON public.google_ads_campaign_community_mappings TO service_role;

ALTER TABLE public.google_ads_campaign_community_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view ads campaign mappings"
  ON public.google_ads_campaign_community_mappings
  FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE POLICY "Import managers can insert ads campaign mappings"
  ON public.google_ads_campaign_community_mappings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "Import managers can update ads campaign mappings"
  ON public.google_ads_campaign_community_mappings
  FOR UPDATE TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "Import managers can delete ads campaign mappings"
  ON public.google_ads_campaign_community_mappings
  FOR DELETE TO authenticated
  USING (public.can_manage_imports(organization_id));

CREATE INDEX google_ads_campaign_mappings_community_idx
  ON public.google_ads_campaign_community_mappings (canonical_community_id);

CREATE TRIGGER google_ads_campaign_mappings_touch
  BEFORE UPDATE ON public.google_ads_campaign_community_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();