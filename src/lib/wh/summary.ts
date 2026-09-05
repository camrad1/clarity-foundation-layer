import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CandidateValue } from "./metrics";

/**
 * Server-side WelcomeHome analytics.
 *
 * Every number on the Sales Intelligence dashboard is computed by the database
 * over the complete normalized dataset. The browser receives aggregates only —
 * it never downloads prospect, activity, contract or deposit rows to count
 * them, so KPI accuracy does not depend on any client row limit.
 *
 * Authorization: the aggregate/drill-through RPCs are SECURITY DEFINER (chosen
 * for performance over large activity volumes) and enforce access explicitly —
 * they reject any organization the caller has no membership in and restrict
 * every read to the caller's authorized community allow-list. Internal helpers
 * such as the successful-ActivityResult resolver are not executable by browser
 * users; only these guarded functions may use them.
 */

export type WhSalesSummary = {
  settings: {
    inquiry_date_field: string;
    move_in_date_field: string;
    move_out_date_field: string;
    deposit_source: string;
    stalled_threshold_days: number;
    hot_no_activity_mode: string;
    exclude_merged_prospects: boolean;
    exclude_discarded_prospects: boolean;
  };
  mappings: { tour: boolean; re_tour: boolean; hot: boolean };
  exclusions: { total: number; merged: number; discarded: number; countable: number };
  inquiries: number;
  /** V-002 primary KPI: successful tour activities completed in the period. */
  tours: number;
  /** Successful repeat tours (not the prospect's first completed tour). */
  reTours: number;
  tourRecon: {
    totalTourActivities: number;
    successfulTours: number;
    initialTours: number;
    repeatTours: number;
    unsuccessfulTours: number;
    successfulResultLabels: string[];
    byResult: { result: string; successful: boolean; n: number }[];
  };
  /** V-003: distinct depositors with a standard deposit dated in the period. */
  deposits: number;
  depositRecon: {
    depositors: number;
    fromTransactions: number;
    zeroAmountRows: number;
    fromContracts: number;
    refunds: number;
    waitlist: number;
    otherTypes: number;
  };

  moveIns: number;
  moveOuts: number;
  moveRecon: {
    moveIns: number;
    transferIns: number;
    canceledMoveIns: number;
    moveOuts: number;
    transferOuts: number;
    canceledMoveOuts: number;
  };
  pending: { pendingIn: number; pendingOut: number };

  pipeline: number;
  hot: number;
  hotNoActivity: number;
  stalled: number;
  overdue: number;
  cohort: {
    cohortSize: number;
    toured: number | null;
    deposited: number;
    movedIn: number;
    linkageCoverage: number | null;
  };
  counselors: { id: string; activities: number; tours: number; moveIns: number; pipeline: number }[];
  leadSources: { id: string; inquiries: number; tours?: number; moveIns: number }[];
  utm: { total: number; counts: Record<string, number> };
  occupancy: {
    /** Every WelcomeHome Unit record, including non-residential pseudo-units. */
    totalUnits: number;
    /** Units the source explicitly flags off_census. */
    offCensusUnits: number;
    /** Recognized non-residential pseudo-units (e.g. WAITLIST). */
    pseudoUnits: number;
    /** Units discarded or marked inactive by the source. */
    inactiveUnits: number;
    /** All excluded units, whatever the reason. */
    excludedUnits: number;
    /** Denominator: total unit records minus every deterministic exclusion. */
    censusUnits: number;
    occupiedUnitsCandidate: number;
    noticeCount: number;
    pendingMoveIns: number;
  };

  stageDistribution: { id: string; n: number }[];
  generatedAt: string;
};

export function useWhSalesSummary(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["wh_sales_summary", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId && enabled,
    queryFn: async (): Promise<WhSalesSummary> => {
      const { data, error } = await (supabase as any).rpc("wh_sales_summary", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return data as WhSalesSummary;
    },
  });
}

export type WhTrendRow = {
  month: string;
  inquiries: number;
  tours: number;
  re_tours: number;
  deposits: number;
  move_ins: number;
  move_outs: number;
  net_move_ins: number;
};

/**
 * Monthly period-event trend. One bounded server-side aggregate covers the
 * whole window — the browser never calls wh_sales_summary once per month and
 * never downloads fact rows. Predicates are identical to the validated KPIs.
 */
export function useWhSalesTrend(
  organizationId: string | null,
  communityIds: string[],
  end: string,
  months = 12,
) {
  return useQuery({
    queryKey: ["wh_sales_trend", organizationId, communityIds.join(","), end, months],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhTrendRow[]> => {
      const { data, error } = await (supabase as any).rpc("wh_sales_trend", {
        _org_id: organizationId,
        _end: end,
        _months: months,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as WhTrendRow[];
    },
  });
}

export type WhActivityMixRow = { category: string; activities: number };

/** Completed activities in the period grouped by mapped semantic category. */
export function useWhActivityMix(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
) {
  return useQuery({
    queryKey: ["wh_activity_mix", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhActivityMixRow[]> => {
      const { data, error } = await (supabase as any).rpc("wh_activity_mix", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as WhActivityMixRow[];
    },
  });
}


export type WhProspectRow = {
  id: string;
  source_id: string;
  community_id: string | null;
  stage_id: string | null;
  score_id: string | null;
  status: string | null;
  next_activity_scheduled_at: string | null;
  last_contact_at: string | null;
  current_sales_counselor_id: string | null;
  total_count: number;
};

export type WhProspectBucket = "pipeline" | "overdue" | "hot" | "hot_no_activity" | "stalled";

/** Paginated drill-through. Never returns the whole table. */
export function useWhProspectPage(
  organizationId: string | null,
  bucket: WhProspectBucket,
  communityIds: string[],
  page: number,
  pageSize = 50,
) {
  return useQuery({
    queryKey: ["wh_prospect_page", organizationId, bucket, communityIds.join(","), page, pageSize],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wh_prospect_page", {
        _org_id: organizationId,
        _bucket: bucket,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: pageSize,
        _offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as WhProspectRow[];
      return { rows, total: rows.length ? Number(rows[0]!.total_count) : 0 };
    },
  });
}

export type WhCompletenessRow = {
  source_table: string;
  stored_rows: number;
  last_sync_rows: number | null;
  last_sync_at: string | null;
};

export type WhDepositRow = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  transaction_type: string | null;
  deposit_type: string | null;
  amount: number | null;
  occurred_local_date: string | null;
  total_count: number;
};

/**
 * Paginated drill-through for the Deposit KPI. Returns only the transactions
 * the KPI counts (V-003: transaction_type = Deposit AND deposit_type =
 * Deposit), filtered server-side; refunds and waitlist deposits never appear.
 */
export function useWhDepositPage(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  page: number,
  pageSize = 50,
) {
  return useQuery({
    queryKey: ["wh_deposit_page", organizationId, communityIds.join(","), start, end, page, pageSize],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wh_deposit_page", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: pageSize,
        _offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as WhDepositRow[];
      return { rows, total: rows.length ? Number(rows[0]!.total_count) : 0 };
    },
  });
}


export type WhTourRow = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  activity_type_label: string | null;
  result_label: string | null;
  successful: boolean;
  first_completed_of_type: boolean | null;
  completed_local_date: string | null;
  total_count: number;
};

/**
 * Paginated drill-through for the Tour KPI (V-002). `mode = "successful"`
 * returns exactly the activities the KPI counts; `mode = "all"` returns every
 * tour activity in the period as a diagnostic. Filtering happens server-side.
 */
export function useWhTourPage(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  mode: "successful" | "all",
  page: number,
  pageSize = 50,
) {
  return useQuery({
    queryKey: ["wh_tour_page", organizationId, communityIds.join(","), start, end, mode, page, pageSize],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wh_tour_page", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _mode: mode,
        _limit: pageSize,
        _offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as WhTourRow[];
      return { rows, total: rows.length ? Number(rows[0]!.total_count) : 0 };
    },
  });
}

/** Stored volume per source table vs the most recent sync's persisted rows. */
export function useWhCompleteness(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_completeness", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhCompletenessRow[]> => {
      const { data, error } = await (supabase as any).rpc("wh_data_completeness", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as WhCompletenessRow[];
    },
  });
}

/** Wraps a server count in the provisional-candidate shape the UI understands. */
export function candidate(value: number, note: string): CandidateValue {
  return { resolved: true, value, ids: [], note };
}

export function withheld(reason: string): CandidateValue {
  return { resolved: false, reason };
}

export type WhExcludedUnitRow = {
  source_id: string;
  unit_number: string | null;
  unit_name: string | null;
  floor_plan_label: string | null;
  exclusion_reason: string;
};

/**
 * Unit reconciliation diagnostic: every Unit record excluded from the census
 * denominator, with the deterministic reason. No resident data is returned.
 */
export function useWhUnitCensusReport(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_unit_census_report", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhExcludedUnitRow[]> => {
      const { data, error } = await (supabase as any).rpc("wh_unit_census_report", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as WhExcludedUnitRow[];
    },
  });
}

export const UNIT_EXCLUSION_LABELS: Record<string, string> = {
  off_census: "Explicitly flagged off-census by the source",
  inactive: "Discarded or inactive unit record",
  pseudo_unit: "Non-residential pseudo-unit",
};

export type WhMoveInRow = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  unit_source_id: string | null;
  financial_move_in_date: string | null;
  status: string | null;
  total_count: number;
};

/**
 * Paginated drill-through for the Move-In KPI (V-004). `mode = "move_in"`
 * returns exactly the contracts the KPI counts (count_move_in true, financial
 * move-in date in period, lease not canceled); `mode = "transfer_in"` is a
 * diagnostic listing of in-period contracts the source marks non-countable.
 * Filtering and authorization happen server-side in wh_move_in_page.
 */
export function useWhMoveInPage(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  mode: "move_in" | "transfer_in",
  page: number,
  pageSize = 50,
) {
  return useQuery({
    queryKey: ["wh_move_in_page", organizationId, communityIds.join(","), start, end, mode, page, pageSize],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wh_move_in_page", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _mode: mode,
        _limit: pageSize,
        _offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as WhMoveInRow[];
      return { rows, total: rows.length ? Number(rows[0]!.total_count) : 0 };
    },
  });
}

export type MetricValidationRecord = {
  id: string;
  community_id: string | null;
  metric_key: string;
  metric_version: number | null;
  period_start: string;
  period_end: string;
  calculated_value: number | null;
  expected_value: number | null;
  difference: number | null;
  status: string;
  official_source: string | null;
  evidence_scope: string;
  reviewer_notes: string | null;
  validated_at: string | null;
};

/** Persisted reconciliation evidence for the organization (RLS: org admins). */
export function useMetricValidationEvidence(organizationId: string | null, prefix = "wh.") {
  return useQuery({
    queryKey: ["metric_validation_checks", organizationId, prefix],
    enabled: !!organizationId,
    queryFn: async (): Promise<MetricValidationRecord[]> => {
      const { data, error } = await (supabase as any)
        .from("metric_validation_checks")
        .select(
          "id, community_id, metric_key, metric_version, period_start, period_end, calculated_value, expected_value, difference, status, official_source, evidence_scope, reviewer_notes, validated_at",
        )
        .eq("organization_id", organizationId)
        .like("metric_key", `${prefix}%`)
        .order("metric_key");
      if (error) throw error;
      return (data ?? []) as MetricValidationRecord[];
    },
  });
}
