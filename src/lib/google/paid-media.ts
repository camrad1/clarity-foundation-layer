import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Paid Media read layer.
 *
 * Two canonical sources are read separately and never merged at record level:
 *
 *  - Google Ads (`google_ads_api_facts`) for spend, impressions, clicks and
 *    Google Ads conversions, through `google_ads_paid_report`.
 *  - WelcomeHome (`wh_prospects` / `wh_activities` / `wh_housing_contracts`)
 *    for inquiries, completed tours and move-ins, restricted to lead sources an
 *    admin explicitly classified as paid, through `wh_paid_media_outcomes`.
 *
 * The CRM carries no campaign identifier, so cost-per-outcome numbers are an
 * association at community + period + approved paid lead-source level. They are
 * labelled "paid-media associated" everywhere in the UI and are never presented
 * as campaign-generated conversions or as ROI.
 */

export const ADS_SOURCE_LABEL = "Source: Google Ads API";
export const WH_SOURCE_LABEL = "Source: WelcomeHome (approved paid lead sources)";

export type PaidPeriod = { start: string; end: string };

export type AdsTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
  firstDate: string | null;
  lastDate: string | null;
  days: number;
};

export type AdsSeriesPoint = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type AdsCampaignRow = {
  campaignId: string;
  campaignName: string | null;
  status: string | null;
  channelType: string | null;
  communityId: string | null;
  communityName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type AdsCommunityRow = {
  communityId: string;
  communityName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type AdsDeviceRow = {
  device: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type AdsConversionActionRow = {
  actionId: string;
  name: string | null;
  category: string | null;
  primary: boolean | null;
  conversions: number;
  conversionsValue: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type AdsPaidReport = {
  scoped: boolean;
  totals: AdsTotals;
  series: AdsSeriesPoint[];
  campaigns: AdsCampaignRow[];
  byCommunity: AdsCommunityRow[];
  unmapped: {
    spend: number;
    clicks: number;
    campaigns: { campaignId: string; campaignName: string | null; spend: number }[];
  };
  totalAccountSpend: number;
  devices: AdsDeviceRow[];
  conversionActions: AdsConversionActionRow[];
  health: { latestDate: string | null; currency: string | null; timeZone: string | null };
  mappingCoverage: { campaigns: number; mapped: number };
};

export type WhPaidOutcomes = {
  paidLeadSourceIds: string[];
  inquiries: number;
  tours: number;
  moveIns: number;
  /** All WelcomeHome inquiries in scope, paid and non-paid. Context only. */
  allInquiries: number;
  byMonth: { month: string; inquiries: number; tours: number; moveIns: number }[];
  byCommunity: { communityId: string; inquiries: number; tours: number; moveIns: number }[];
  bySource: { leadSourceId: string; inquiries: number; tours: number; moveIns: number }[];
  latestProspectDate: string | null;
};

function scope(ids?: string[] | null) {
  return ids && ids.length ? ids : null;
}

export function useAdsPaidReport(
  organizationId: string | null,
  period: PaidPeriod | null,
  communityIds?: string[] | null,
) {
  const ids = scope(communityIds);
  return useQuery({
    queryKey: ["google_ads_paid_report", organizationId, period?.start, period?.end, ids],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<AdsPaidReport | null> => {
      const { data, error } = await supabase.rpc("google_ads_paid_report" as any, {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        ...(ids ? { _community_ids: ids } : {}),
      });
      if (error) throw error;
      return (data as AdsPaidReport | null) ?? null;
    },
  });
}

export function useWhPaidOutcomes(
  organizationId: string | null,
  period: PaidPeriod | null,
  communityIds?: string[] | null,
) {
  const ids = scope(communityIds);
  return useQuery({
    queryKey: ["wh_paid_media_outcomes", organizationId, period?.start, period?.end, ids],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<WhPaidOutcomes | null> => {
      const { data, error } = await supabase.rpc("wh_paid_media_outcomes" as any, {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        ...(ids ? { _community_ids: ids } : {}),
      });
      if (error) throw error;
      return (data as WhPaidOutcomes | null) ?? null;
    },
  });
}

/** Approved paid lead sources, for the methodology disclosure. */
export function usePaidLeadSources(organizationId: string | null) {
  return useQuery({
    queryKey: ["wh_paid_lead_source_classifications", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_paid_lead_source_classifications" as any)
        .select("lead_source_id, lead_source_label, channel, include_in_google_ads_cost")
        .eq("organization_id", organizationId!)
        .order("lead_source_label");
      if (error) throw error;
      return (data ?? []) as unknown as {
        lead_source_id: string;
        lead_source_label: string;
        channel: string;
        include_in_google_ads_cost: boolean;
      }[];
    },
  });
}

/** Cost per outcome. Null whenever the denominator is missing or zero. */
export function costPer(spend: number | null | undefined, count: number | null | undefined) {
  if (spend === null || spend === undefined) return null;
  if (!count || count <= 0) return null;
  return spend / count;
}

export const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(n: number | null | undefined, precise = false): string {
  if (n === null || n === undefined) return "—";
  return precise ? usd2.format(n) : usd.format(n);
}

/** Relative change between two values; null when the base is unusable. */
export function relChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function changeDelta(
  current: number | null,
  previous: number | null,
  opts?: { invert?: boolean },
) {
  const rel = relChange(current, previous);
  if (rel === null) return null;
  const improving = opts?.invert ? rel < 0 : rel > 0;
  const tone = rel === 0 ? ("neutral" as const) : improving ? ("up" as const) : ("down" as const);
  return { label: `${rel > 0 ? "+" : ""}${(rel * 100).toFixed(1)}%`, tone };
}
