import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Standard WelcomeHome operational reports.
 *
 * Every hook here calls exactly one bounded server-side aggregate that returns
 * the whole requested trend window. The browser never loops months, never
 * downloads fact rows, and never recomputes a KPI: move-in, move-out and
 * inquiry predicates inside these functions are the same validated ones used
 * by wh_sales_summary / wh_sales_trend.
 */

const db = supabase as any;

export type OccupancyHistoryRow = {
  month: string;
  beginning_occupied: number | null;
  beginning_census: number | null;
  beginning_pct: number | null;
  ending_occupied: number | null;
  ending_census: number | null;
  ending_pct: number | null;
  budget_pct: number | null;
  move_ins: number;
  move_outs: number;
  net_move_ins: number;
  communities_in_scope: number;
};

/**
 * Month-over-month occupancy history.
 *
 * Beginning/ending occupancy come only from immutable daily snapshots dated
 * the first and last day of the month, and only when every community in scope
 * has one. Nothing is carried forward or reconstructed from current-state
 * data: a month without snapshots returns null and renders as an em dash.
 * Period-event move-ins/move-outs still populate from validated event logic.
 */
export function useOccupancyHistory(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["wh_occupancy_monthly_history", organizationId, communityIds.join(","), end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<OccupancyHistoryRow[]> => {
      const { data, error } = await db.rpc("wh_occupancy_monthly_history", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as OccupancyHistoryRow[];
    },
  });
}

export type MoveInSourceRow = { month: string; lead_source_label: string; move_ins: number };

/** Move-ins grouped by the prospect's primary lead source, per calendar month. */
export function useMoveInsByLeadSource(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["wh_move_ins_by_lead_source_monthly", organizationId, communityIds.join(","), end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<MoveInSourceRow[]> => {
      const { data, error } = await db.rpc("wh_move_ins_by_lead_source_monthly", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as MoveInSourceRow[];
    },
  });
}

export type MoveOutReasonRow = {
  month: string;
  reason_label: string;
  move_outs: number;
  los_days: number | null;
  los_sample: number;
};

/**
 * Move-outs grouped by the WelcomeHome move-out reason recorded on the housing
 * contract. Length of stay is the elapsed days between the same move-in and
 * move-out date fields the validated KPIs use — it is only reported for
 * contracts that carry both dates, and the sample size travels with it.
 */
export function useMoveOutReasons(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["wh_move_out_reason_summary", organizationId, communityIds.join(","), end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<MoveOutReasonRow[]> => {
      const { data, error } = await db.rpc("wh_move_out_reason_summary", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as MoveOutReasonRow[];
    },
  });
}

export type InquiryBucketRow = { bucket: string; inquiries: number };

/** Validated wh.new_inquiries counted into server-side month or week buckets. */
export function useNewInquiriesTrend(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  grain: "month" | "week",
  periods: number,
) {
  return useQuery({
    queryKey: ["wh_new_inquiries_monthly", organizationId, communityIds.join(","), end, grain, periods],
    enabled: !!organizationId,
    queryFn: async (): Promise<InquiryBucketRow[]> => {
      const { data, error } = await db.rpc("wh_new_inquiries_monthly", {
        _org_id: organizationId,
        _end: end,
        _periods: periods,
        _grain: grain,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as InquiryBucketRow[];
    },
  });
}

export type LostLeadRow = { month: string; reason_label: string; lost_leads: number };

/** Closed prospects grouped by the structured WelcomeHome close reason. */
export function useLostLeads(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["wh_lost_lead_summary", organizationId, communityIds.join(","), end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<LostLeadRow[]> => {
      const { data, error } = await db.rpc("wh_lost_lead_summary", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as LostLeadRow[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Shared presentation helpers for the report tabs.                    */
/* ------------------------------------------------------------------ */

/**
 * Coordinated categorical palette derived from the ClarityIQ brand blue
 * (#285172): tints and shades of the same hue plus two restrained accents, so
 * many series stay distinguishable without turning the dashboard into a
 * rainbow. Semantic amber/red are deliberately excluded — they mean
 * provisional and negative, never "category 7".
 */
export const CATEGORY_COLORS = [
  "#285172",
  "#4a7ba0",
  "#7aa3c2",
  "#173449",
  "#a7c4d9",
  "#356f8f",
  "#5f93b5",
  "#0f2537",
  "#8fb2cb",
  "#20607f",
] as const;

export function categoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;
}

/** Stable, readable key for a label used as a Recharts dataKey. */
export function seriesKey(label: string): string {
  return `s_${label.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`;
}

/**
 * Pivot server-aggregated (bucket, category, value) rows into one row per
 * bucket. This is a presentation reshape of aggregates, not fact aggregation.
 */
export function pivotByBucket<T extends Record<string, any>>(
  rows: T[],
  bucketField: keyof T,
  labelField: keyof T,
  valueField: keyof T,
  buckets: string[],
): Record<string, any>[] {
  const byBucket = new Map<string, Record<string, any>>();
  for (const b of buckets) byBucket.set(b, { bucket: b });
  for (const r of rows) {
    const b = String(r[bucketField]).slice(0, 10);
    const row = byBucket.get(b) ?? { bucket: b };
    row[seriesKey(String(r[labelField]))] = Number(r[valueField] ?? 0);
    byBucket.set(b, row);
  }
  return buckets.map((b) => byBucket.get(b) ?? { bucket: b });
}

/** Distinct category labels ordered by total volume, highest first. */
export function rankCategories<T extends Record<string, any>>(
  rows: T[],
  labelField: keyof T,
  valueField: keyof T,
): { label: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = String(r[labelField]);
    totals.set(key, (totals.get(key) ?? 0) + Number(r[valueField] ?? 0));
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const body = rows
    .map((r) =>
      r
        .map((cell) => {
          const v = cell == null ? "" : String(cell);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
