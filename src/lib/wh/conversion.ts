import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Conversion analytics.
 *
 * Everything here is produced by public.wh_conversion_rates /
 * public.wh_conversion_series over the complete normalized WelcomeHome
 * dataset. No conversion numerator or denominator is derived in the browser —
 * the client only divides two server-supplied counts for display.
 *
 * Two concepts are kept strictly apart:
 *  - cohort.*  prospects whose INQUIRY date falls in the selected period,
 *              followed forward in time (their tour/deposit/move-in may land
 *              after the period end). This is a true conversion rate.
 *  - period.*  stage events RECORDED in the selected period. Ratios between
 *              those counts are descriptive activity ratios, not conversion.
 */

export type ConversionBreakdownRow = {
  id: string;
  inquiries: number;
  toured: number;
  deposited: number;
  movedIn: number;
};

export type ConversionCommunityRow = ConversionBreakdownRow & {
  periodTours: number;
  periodDeposits: number;
  periodMoveIns: number;
};

export type WhConversion = {
  scopeCommunities: number;
  mappings: { tour: boolean };
  /** Stage events recorded in the period — descriptive only. */
  period: { inquiries: number; tours: number; reTours: number; deposits: number; moveIns: number };
  /** True cohort follow-through for prospects who inquired in the period. */
  cohort: {
    size: number;
    toured: number | null;
    deposited: number;
    movedIn: number;
    touredThenDeposited: number;
    depositedThenMovedIn: number;
  };
  maturity: { bucket: string; size: number; toured: number; deposited: number; movedIn: number }[];
  byLeadSource: ConversionBreakdownRow[];
  byCounselor: ConversionBreakdownRow[];
  byCommunity: ConversionCommunityRow[];
  asOf: string;
  generatedAt: string;
};

export type ConversionPoint = {
  bucket: string;
  inquiries: number;
  toured: number;
  deposited: number;
  movedIn: number;
};

/**
 * Deterministic minimum cohort size before a conversion rate is shown for a
 * breakdown row (lead source, counselor, community). Below it the raw counts
 * are still shown, but the rate is suppressed and flagged "Small sample" so a
 * 1-of-2 cohort never reads as 50% performance. Recorded in the Metric
 * Registry (min_sample) alongside each conversion definition.
 */
export const MIN_COHORT_SAMPLE = 20;

export function useWhConversion(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["wh_conversion_rates", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<WhConversion> => {
      const { data, error } = await (supabase as any).rpc("wh_conversion_rates", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return data as WhConversion;
    },
  });
}

export function useWhConversionSeries(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  grain: "day" | "week" | "month",
  enabled = true,
) {
  return useQuery({
    queryKey: ["wh_conversion_series", organizationId, communityIds.join(","), start, end, grain],
    enabled: !!organizationId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<{ grain: string; points: ConversionPoint[] }> => {
      const { data, error } = await (supabase as any).rpc("wh_conversion_series", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _grain: grain,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return {
        grain: (data as any)?.grain ?? grain,
        points: ((data as any)?.points ?? []) as ConversionPoint[],
      };
    },
  });
}

/** Share as a 0–1 ratio, or null when the denominator is zero/unknown. */
export function rate(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}
