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
  deposits: number;
  depositRecon: {
    fromTransactions: number;
    fromContracts: number;
    refunds: number;
    waitlist: number;
    otherTypes: number;
  };

  moveIns: number;
  moveOuts: number;
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
  leadSources: { id: string; inquiries: number; moveIns: number }[];
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
) {
  return useQuery({
    queryKey: ["wh_sales_summary", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId,
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
