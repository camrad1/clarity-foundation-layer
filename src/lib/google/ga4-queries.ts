import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Canonical GA4 read layer.
 *
 * GA4 is canonical for website traffic only — sessions, users, engagement,
 * views, source/medium, campaign, channel group, landing pages and device.
 * It never redefines WelcomeHome inquiries/tours/deposits/move-ins, occupancy,
 * Further conversations or Search Console visibility.
 *
 * Every read hits `ga4_api_facts` through security-definer RPCs that carry the
 * real calendar date, so results follow the global date filter, comparison
 * period and custom ranges exactly. Partial current-day rows are excluded by
 * default so a partial day is never compared against a completed one.
 *
 * Grains stay separate: totals come from `daily_totals`, breakdowns come from
 * their own grain, and community scope only ever comes from landing pages that
 * a deterministic URL rule mapped. Property-wide totals are never split across
 * communities.
 */

export const GA4_SOURCE_LABEL = "Source: Google Analytics 4 API";

export type Ga4Period = { start: string; end: string };

export type Ga4Totals = {
  sessions: number;
  active_users: number;
  new_users: number;
  engaged_sessions: number;
  screen_page_views: number;
  engagement_rate: number | null;
  days: number;
  partial_days: number;
  first_date: string | null;
  last_date: string | null;
};

export type Ga4SeriesPoint = {
  date: string;
  sessions: number;
  active_users: number;
  new_users: number;
  engaged_sessions: number;
  screen_page_views: number;
  engagement_rate: number | null;
  is_partial_day: boolean;
};

export type Ga4CoverageRow = {
  report: string;
  first_date: string | null;
  last_date: string | null;
  row_count: number;
  partial_rows: number;
  mapped_rows: number;
};

export type Ga4Health = {
  first_date: string | null;
  last_date: string | null;
  last_complete_date: string | null;
  partial_date: string | null;
  total_rows: number;
  landing_rows: number;
  mapped_landing_rows: number;
  missing_days: number;
};

export type Ga4DimensionRow = {
  dimension_value: string;
  secondary_value: string | null;
  sessions: number;
  active_users: number;
  new_users: number;
  engaged_sessions: number;
  screen_page_views: number;
  engagement_rate: number | null;
};

export type Ga4LandingRow = {
  landing_path: string;
  mapped_community_id: string | null;
  sessions: number;
  active_users: number;
  new_users: number;
  engaged_sessions: number;
  screen_page_views: number;
  engagement_rate: number | null;
};

/** GA4 dimension grains. Each is stored and reported separately. */
export type Ga4Dimension = "source_medium" | "source_medium_campaign" | "channel_group" | "device";

export const GA4_DIMENSION_LABELS: Record<Ga4Dimension, string> = {
  source_medium: "Source / medium",
  source_medium_campaign: "Source / medium / campaign",
  channel_group: "Default channel group",
  device: "Device",
};

/** null = portfolio (property-wide totals); a list = mapped landing pages only. */
function scope(communityIds: string[] | null | undefined): string[] | null {
  return communityIds && communityIds.length ? communityIds : null;
}

export function useGa4Coverage(organizationId: string | null) {
  return useQuery({
    queryKey: ["ga4_coverage", organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Ga4CoverageRow[]> => {
      const { data, error } = await supabase.rpc("ga4_coverage", { _org_id: organizationId! });
      if (error) throw error;
      return (data ?? []) as Ga4CoverageRow[];
    },
  });
}

export function useGa4Health(organizationId: string | null) {
  return useQuery({
    queryKey: ["ga4_health", organizationId],
    enabled: !!organizationId,
    staleTime: 60_000,
    queryFn: async (): Promise<Ga4Health | null> => {
      const { data, error } = await supabase.rpc("ga4_health", { _org_id: organizationId! });
      if (error) throw error;
      return ((data ?? [])[0] as Ga4Health | undefined) ?? null;
    },
  });
}

export function useGa4Totals(
  organizationId: string | null,
  period: Ga4Period | null,
  communityIds?: string[] | null,
  /** Only turn on for explicit "today so far" views, never for comparisons. */
  includePartial = false,
) {
  const ids = scope(communityIds);
  return useQuery({
    queryKey: ["ga4_daily_totals", organizationId, period?.start, period?.end, ids, includePartial],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<Ga4Totals | null> => {
      const { data, error } = await supabase.rpc("ga4_daily_totals", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        _community_ids: ids,
        _include_partial: includePartial,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as Ga4Totals | undefined;
      return row ?? null;
    },
  });
}

export function useGa4Series(
  organizationId: string | null,
  period: Ga4Period | null,
  communityIds?: string[] | null,
) {
  const ids = scope(communityIds);
  return useQuery({
    queryKey: ["ga4_daily_series", organizationId, period?.start, period?.end, ids],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<Ga4SeriesPoint[]> => {
      const { data, error } = await supabase.rpc("ga4_daily_series", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        _community_ids: ids,
      });
      if (error) throw error;
      return (data ?? []) as Ga4SeriesPoint[];
    },
  });
}

export function useGa4Dimension(
  organizationId: string | null,
  period: Ga4Period | null,
  dimension: Ga4Dimension,
  limit = 100,
) {
  return useQuery({
    queryKey: ["ga4_dimension", organizationId, period?.start, period?.end, dimension, limit],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<Ga4DimensionRow[]> => {
      const { data, error } = await supabase.rpc("ga4_dimension_report", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        _dimension: dimension,
        _limit: limit,
        _include_partial: false,
      });
      if (error) throw error;
      return (data ?? []) as Ga4DimensionRow[];
    },
  });
}

export function useGa4LandingPages(
  organizationId: string | null,
  period: Ga4Period | null,
  communityIds?: string[] | null,
  limit = 200,
) {
  const ids = scope(communityIds);
  return useQuery({
    queryKey: ["ga4_landing", organizationId, period?.start, period?.end, ids, limit],
    enabled: !!organizationId && !!period,
    queryFn: async (): Promise<Ga4LandingRow[]> => {
      const { data, error } = await supabase.rpc("ga4_landing_page_report", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        _community_ids: ids,
        _limit: limit,
        _include_partial: false,
      });
      if (error) throw error;
      return (data ?? []) as Ga4LandingRow[];
    },
  });
}

/**
 * Honest coverage statement for a period: GA4 either covers the whole selected
 * range, part of it, or none of it. Nothing is prorated or estimated.
 */
export function ga4Coverage(totals: Ga4Totals | null | undefined, period: Ga4Period) {
  if (!totals || !totals.first_date || !totals.last_date || !totals.days)
    return { extent: "none" as const, partial: false };
  const full = totals.first_date <= period.start && totals.last_date >= period.end;
  return { extent: full ? ("full" as const) : ("partial" as const), partial: !full };
}
