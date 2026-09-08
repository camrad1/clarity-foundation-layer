CREATE OR REPLACE FUNCTION public.google_ads_campaign_inventory(_org_id uuid)
RETURNS TABLE (
  campaign_id text,
  campaign_name text,
  campaign_status text,
  google_ads_customer_id text,
  first_date date,
  last_date date,
  impressions bigint,
  clicks bigint,
  cost numeric,
  conversions numeric,
  mapping_id uuid,
  canonical_community_id uuid,
  community_name text,
  mapping_method text,
  is_active boolean,
  mapped_campaign_name text,
  valid_from date,
  valid_to date,
  notes text,
  mapping_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH facts AS (
    SELECT f.campaign_id::text AS campaign_id,
           max(f.campaign_name) AS campaign_name,
           max(f.campaign_status) AS campaign_status,
           max(f.customer_id::text) AS google_ads_customer_id,
           min(f.date) AS first_date,
           max(f.date) AS last_date,
           sum(coalesce(f.impressions,0))::bigint AS impressions,
           sum(coalesce(f.clicks,0))::bigint AS clicks,
           sum(coalesce(f.cost,0)) AS cost,
           sum(coalesce(f.conversions,0)) AS conversions
    FROM public.google_ads_api_facts f
    WHERE f.organization_id = _org_id
      AND f.grain = 'campaign_day'
      AND f.campaign_id IS NOT NULL
    GROUP BY f.campaign_id::text
  )
  SELECT fa.campaign_id, fa.campaign_name, fa.campaign_status, fa.google_ads_customer_id,
         fa.first_date, fa.last_date, fa.impressions, fa.clicks, fa.cost, fa.conversions,
         m.id, m.canonical_community_id, c.name, m.mapping_method, m.is_active,
         m.campaign_name, m.valid_from, m.valid_to, m.notes, m.updated_at
  FROM facts fa
  LEFT JOIN public.google_ads_campaign_community_mappings m
    ON m.organization_id = _org_id AND m.campaign_id = fa.campaign_id
  LEFT JOIN public.communities c ON c.id = m.canonical_community_id
  WHERE public.has_org_access(_org_id)
  ORDER BY fa.last_date DESC, fa.cost DESC;
$$;

REVOKE ALL ON FUNCTION public.google_ads_campaign_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_ads_campaign_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.google_ads_campaign_inventory(uuid) TO service_role;