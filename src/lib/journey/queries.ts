import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Period } from "@/lib/date-ranges";

/**
 * Performance Journey read layer.
 *
 * Nothing here defines a metric. Every value comes from the canonical
 * database functions already used by Marketing Intelligence, Sales
 * Intelligence, Occupancy Intelligence and the Further match layer:
 *
 *   journey_community_matrix — per-community stage counts built from the same
 *     WelcomeHome settings, activity/result mappings, deposit rules, Further
 *     active exact-ID matches and GA4 mapped landing pages the rest of the app
 *     uses.
 *   journey_further_stage   — Further cohort for the selected period plus its
 *     exact-ID match outcomes in WelcomeHome.
 *   journey_stage_series    — one row per bucket across all stages.
 *   gsc_api_page_report     — reused unchanged for community-scoped visibility.
 *
 * Aggregation stays in the database so the browser never sums raw rows.
 */

const db = supabase as any;

export type JourneyCommunityRow = {
  community_id: string;
  community_name: string;
  sessions: number;
  engaged_sessions: number;
  further_leads: number;
  further_matched: number;
  inquiries: number;
  tours: number;
  re_tours: number;
  deposits: number;
  move_ins: number;
  move_outs: number;
};

export function useJourneyMatrix(
  organizationId: string | null,
  communityIds: string[],
  period: Period | null,
) {
  return useQuery({
    queryKey: ["journey_matrix", organizationId, communityIds.join(","), period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<JourneyCommunityRow[]> => {
      const { data, error } = await db.rpc("journey_community_matrix", {
        _org_id: organizationId,
        _start: period!.start,
        _end: period!.end,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as JourneyCommunityRow[];
    },
  });
}

export type JourneyFurtherStage = {
  leads: number;
  with_external_id: number;
  matched: number;
  conflicts: number;
  tour_scheduled: number;
  matched_toured: number;
  matched_deposited: number;
  matched_moved_in: number;
  first_lead: string | null;
  last_lead: string | null;
  unmapped_leads: number;
};

export function useJourneyFurther(
  organizationId: string | null,
  communityIds: string[],
  period: Period | null,
) {
  return useQuery({
    queryKey: ["journey_further", organizationId, communityIds.join(","), period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<JourneyFurtherStage | null> => {
      const { data, error } = await db.rpc("journey_further_stage", {
        _org_id: organizationId,
        _start: period!.start,
        _end: period!.end,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return ((data ?? [])[0] as JourneyFurtherStage | undefined) ?? null;
    },
  });
}

export type JourneySeriesPoint = {
  bucket: string;
  clicks: number;
  impressions: number;
  sessions: number;
  further_leads: number;
  inquiries: number;
  tours: number;
  deposits: number;
  move_ins: number;
};

export type SeriesGrain = "day" | "week" | "month";

/** Bucket size follows the length of the selected range, never the reverse. */
export function grainForPeriod(period: Period): SeriesGrain {
  const days =
    Math.round(
      (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86400000,
    ) + 1;
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  return "month";
}

export function useJourneySeries(
  organizationId: string | null,
  communityIds: string[],
  period: Period | null,
  grain: SeriesGrain,
) {
  return useQuery({
    queryKey: [
      "journey_series",
      organizationId,
      communityIds.join(","),
      period?.start,
      period?.end,
      grain,
    ],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<JourneySeriesPoint[]> => {
      const { data, error } = await db.rpc("journey_stage_series", {
        _org_id: organizationId,
        _start: period!.start,
        _end: period!.end,
        _grain: grain,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as JourneySeriesPoint[];
    },
  });
}

export type VisibilityTotals = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  pages: number;
};

/**
 * Community-scoped visibility. Search Console has no community dimension, so
 * this reuses the existing page report and its deterministic URL mapping
 * rules — the same rule set Page Intelligence uses. Nothing is prorated.
 */
export function useCommunityVisibility(
  organizationId: string | null,
  communityId: string | null,
  period: Period | null,
) {
  return useQuery({
    queryKey: ["journey_visibility", organizationId, communityId, period?.start, period?.end],
    enabled: !!organizationId && !!communityId && !!period,
    queryFn: async (): Promise<VisibilityTotals> => {
      const { data, error } = await db.rpc("gsc_api_page_report", {
        _org_id: organizationId,
        _start: period!.start,
        _end: period!.end,
        _community_id: communityId,
        _limit: 10000,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        clicks: number;
        impressions: number;
        position_value: number | null;
      }[];
      let clicks = 0;
      let impressions = 0;
      let weighted = 0;
      for (const r of rows) {
        clicks += Number(r.clicks ?? 0);
        impressions += Number(r.impressions ?? 0);
        if (r.position_value != null) weighted += Number(r.position_value) * Number(r.impressions ?? 0);
      }
      return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : null,
        position: impressions > 0 ? weighted / impressions : null,
        pages: rows.length,
      };
    },
  });
}

/* ------------------------------------------------------------ attribution */

export type EvidenceLevel = 1 | 2 | 3;

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  1: "Exact record-level chain",
  2: "Deterministic association",
  3: "Aggregate relationship",
};

/**
 * Wording is bound to evidence, not to intuition. Level 3 transitions never
 * claim causation — they only state that two measured things moved together.
 */
export const EVIDENCE_VERBS: Record<EvidenceLevel, string> = {
  1: "converted to",
  2: "linked with",
  3: "occurred alongside",
};

export function ratePct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}
