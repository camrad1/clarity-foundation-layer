import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Community Trends data layer.
 *
 * Presentation layer over already-validated canonical metrics. One bounded
 * server-side aggregate (`community_trend_matrix`) returns every authorized
 * community × month in a single request, so the page never fires one report
 * query per community. Metric predicates inside that function are copied from
 * the validated `wh_sales_trend`, `journey_community_matrix` and
 * `wh_occupancy_history_daily` definitions — nothing is redefined here.
 */
export type CommunityTrendRow = {
  community_id: string;
  community_name: string;
  /** First day of the month (date-only, never timezone shifted). */
  month: string;
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
  /** End-of-month occupancy, canonical capacity basis. Null when unavailable. */
  occupancy_pct: number | null;
  occupied_units: number | null;
  census_units: number | null;
  occupancy_source: string | null;
};

export function useCommunityTrendMatrix(
  organizationId: string | null,
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["community_trend_matrix", organizationId, end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<CommunityTrendRow[]> => {
      const { data, error } = await (supabase as any).rpc("community_trend_matrix", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        // Always the full authorized portfolio: this page is a side-by-side
        // board, not a filtered single-community view.
        _community_ids: null,
      });
      if (error) throw error;
      return (data ?? []) as CommunityTrendRow[];
    },
  });
}
