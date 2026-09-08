/**
 * Google Ads campaign -> canonical community mapping.
 *
 * The mapping is explicit and keyed on the stable Google Ads campaign ID.
 * Campaign names are stored for display/audit only and never drive matching:
 * there is no fuzzy matching or name parsing anywhere in this layer.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const orgInput = (d: unknown) => z.object({ organizationId: z.string().uuid() }).parse(d);

export type AdsCampaignMappingRow = {
  campaign_id: string;
  campaign_name: string | null;
  campaign_status: string | null;
  google_ads_customer_id: string | null;
  first_date: string | null;
  last_date: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  mapping_id: string | null;
  canonical_community_id: string | null;
  community_name: string | null;
  mapping_method: string | null;
  is_active: boolean | null;
  mapped_campaign_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  mapping_updated_at: string | null;
};

/** Campaign inventory joined with the explicit mapping rows. RLS-scoped. */
export const adsCampaignMappings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orgInput)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: rows, error } = await supabase.rpc("google_ads_campaign_inventory", {
      _org_id: data.organizationId,
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as AdsCampaignMappingRow[];

    const total = list.length;
    const mapped = list.filter((r) => r.canonical_community_id).length;
    const historical = list.filter(
      (r) => (r.campaign_status ?? "").toUpperCase() !== "ENABLED",
    ).length;
    const unmapped = list.filter((r) => !r.canonical_community_id);
    const activeUnmapped = unmapped.filter(
      (r) => (r.campaign_status ?? "").toUpperCase() === "ENABLED",
    );

    return {
      rows: list,
      summary: {
        total,
        mapped,
        unmapped: unmapped.length,
        historical,
        activeUnmapped: activeUnmapped.length,
        needsReview: list.filter((r) => !r.mapping_id).length,
      },
    };
  });

/** Create or correct one explicit mapping. Never triggered automatically. */
export const adsSetCampaignMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        googleAdsCustomerId: z.string().min(3).max(20),
        campaignId: z.string().min(1).max(40),
        campaignName: z.string().min(1).max(500),
        communityId: z.string().uuid().nullable(),
        notes: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: allowed, error: guardError } = await supabase.rpc("can_manage_imports", {
      _org_id: data.organizationId,
    });
    if (guardError || allowed !== true) throw new Error("Not permitted to manage mappings");

    const payload = {
      organization_id: data.organizationId,
      google_ads_customer_id: data.googleAdsCustomerId,
      campaign_id: data.campaignId,
      campaign_name: data.campaignName,
      canonical_community_id: data.communityId,
      mapping_method: data.communityId ? "manual_override" : "unmapped_historical",
      is_active: !!data.communityId,
      notes: data.notes ?? null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("google_ads_campaign_community_mappings")
      .upsert(payload, { onConflict: "organization_id,google_ads_customer_id,campaign_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
