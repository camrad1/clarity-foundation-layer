import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Community Trends data layer.
 *
 * Presentation layer over already-validated canonical metrics. One bounded
 * server-side aggregate (`community_trend_series`) returns every authorized
 * community × time bucket in a single request, so the page never fires one
 * report query per community, and switching Day / Week / Month re-uses the same
 * aggregate rather than computing buckets inside each chart. Metric predicates
 * inside that function are copied from the validated `wh_sales_trend`,
 * `journey_community_matrix` and `wh_occupancy_history_daily` definitions —
 * nothing is redefined here.
 */
export type TrendGrain = "day" | "week" | "month";

export type CommunityTrendRow = {
  community_id: string;
  community_name: string;
  /** First day of the bucket (date-only, never timezone shifted). */
  bucket: string;
  inquiries: number;
  tours: number;
  re_tours: number;
  /** Provisional: deposit linkage is incomplete in the source CRM. */
  deposits: number;
  move_ins: number;
  move_outs: number;
  net_move_ins: number;
  /** GA4 mapped landing-page sessions only; never property-wide traffic. */
  sessions: number;
  engaged_sessions: number;
  further_leads: number;
  /** Last canonical occupancy value in the bucket (never an average). Null when unavailable. */
  occupancy_pct: number | null;
  occupied_units: number | null;
  census_units: number | null;
  occupancy_source: string | null;
};

/** Days between two date-only strings, inclusive. */
export function rangeDays(start: string, end: string) {
  const a = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Suggested grain for a date range: <=45d day, <=180d week, otherwise month. */
export function suggestGrain(start: string, end: string): TrendGrain {
  const days = rangeDays(start, end);
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}

export function useCommunityTrendSeries(
  organizationId: string | null,
  start: string,
  end: string,
  grain: TrendGrain,
) {
  return useQuery({
    queryKey: ["community_trend_series", organizationId, start, end, grain],
    enabled: !!organizationId,
    queryFn: async (): Promise<CommunityTrendRow[]> => {
      const { data, error } = await (supabase as any).rpc("community_trend_series", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _grain: grain,
        // Always the full authorized portfolio: this page is a side-by-side
        // board, not a filtered single-community view.
        _community_ids: null,
      });
      if (error) throw error;
      return (data ?? []) as CommunityTrendRow[];
    },
  });
}
