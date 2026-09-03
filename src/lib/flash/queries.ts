import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Flash Report data access.
 *
 * Every automated number comes from the bounded server-side aggregate
 * `wh_flash_report` (or a paginated tracker RPC). The browser never counts
 * fact rows, and no KPI predicate is re-implemented here — the RPCs reuse the
 * validated WelcomeHome definitions verbatim.
 */

const db = supabase as any;

export type FlashPeriod = {
  start: string;
  end: string;
  label: string;
  isCurrent?: boolean;
  /**
   * Month row only: false while the calendar month is still in progress (row
   * is labeled MONTH TO DATE and carries no finalized occupancy), true once
   * the month has ended (MONTH END, occupancy from the canonical historical
   * resolver).
   */
  isMonthClosed?: boolean;
  /**
   * Actual completed-event metrics for the period. NULL for a period that has
   * not started yet — future weeks never show activity.
   */
  inquiries: number | null;
  outreach: number | null;
  outreachMapped: boolean;
  tours: number | null;
  reTours: number | null;
  moveIns: number | null;
  moveOuts: number | null;
  net: number | null;
  /**
   * Point-in-time pending state for the REMAINDER OF THE SELECTED MONTH as of
   * now — not the moves scheduled inside this particular week. Only the
   * in-progress period carries it; past/future periods are null.
   */
  pendingIn: number | null;
  pendingOut: number | null;
  pendingNet: number | null;

  /**
   * Forward-looking month-end projection: CURRENT canonical occupied units
   * + pending move-ins − pending move-outs, over the SAME canonical census
   * denominator used by current occupancy. Only produced for an in-progress
   * period — historical periods have no captured pending state and return
   * null rather than borrowing today's.
   */
  projectedOccupiedUnits?: number | null;
  projectedOccupancyPct?: number | null;
  projectedCensusUnits?: number | null;
  projectedOverCapacity?: boolean;
  projectedBasis?: string;
  budget?: FlashBudgetValue | null;
  occupancy?: FlashOccupancy | null;
};

export type FlashBudgetValue = { units: number | null; pct: number | null; communities: number };

export type FlashOccupancy = {
  asOf: string;
  /**
   * `current` = live WelcomeHome contract/unit state as of today.
   * `snapshot` = the immutable daily snapshot taken at that historical date.
   * Historical rows with no snapshot return null occupancy and render as “—”.
   */
  source?: "current" | "snapshot";
  snapshotDate?: string;
  communitiesCovered?: number;
  communitiesRequested?: number;
  complete?: boolean;
  totalUnits: number;
  excludedUnits: number;
  pseudoUnits: number;
  offCensusUnits: number;
  inactiveUnits: number;
  censusUnits: number;
  occupiedUnits: number;
  noticeCount: number;
  byCareType: { careType: string; units: number; occupied: number }[];
};

export type FlashStarting = {
  label: string;
  asOfDate: string;
  occupancy: FlashOccupancy | null;
  budget: FlashBudgetValue | null;
};

export type FlashReport = {
  week: FlashPeriod;
  month: FlashPeriod;
  nextMonth: FlashPeriod;
  weeks: FlashPeriod[];
  starting: FlashStarting;
  occupancy: FlashOccupancy;
  budget: FlashBudgetValue;
  monthStart: string;
  monthEnd: string;
  communities: number;
  generatedAt: string;
};

export function useFlashReport(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  month: string,
) {
  return useQuery({
    queryKey: ["wh_flash_report", organizationId, communityIds.join(","), start, end, month],
    enabled: !!organizationId,
    queryFn: async (): Promise<FlashReport> => {
      const { data, error } = await db.rpc("wh_flash_report", {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _month: month,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return data as FlashReport;
    },
  });
}

function trackerQuery<T>(key: string, fn: string, args: Record<string, unknown>, enabled: boolean) {
  return {
    queryKey: [key, args],
    enabled,
    queryFn: async (): Promise<{ rows: T[]; total: number }> => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw error;
      const rows = (data ?? []) as (T & { total_count: number })[];
      return { rows: rows as T[], total: rows.length ? Number(rows[0]!.total_count) : 0 };
    },
  };
}

export type FlashMoveInRow = {
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  resident_source_id: string | null;
  person_name: string | null;
  move_in_date: string | null;
  care_type: string | null;
  unit_label: string | null;
  is_transfer: boolean | null;
  monthly_rate: number | null;
};

export function useFlashMoveIns(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  limit = 200,
) {
  return useQuery(
    trackerQuery<FlashMoveInRow>(
      "wh_flash_move_ins",
      "wh_flash_move_ins",
      {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: limit,
        _offset: 0,
      },
      !!organizationId,
    ),
  );
}

export type FlashMoveOutRow = {
  source_id: string;
  community_id: string | null;
  resident_source_id: string | null;
  prospect_source_id: string | null;
  person_name: string | null;
  move_out_date: string | null;
  notice_date: string | null;
  care_type: string | null;
  unit_label: string | null;
  reason: string | null;
};

export function useFlashMoveOuts(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  limit = 200,
) {
  return useQuery(
    trackerQuery<FlashMoveOutRow>(
      "wh_flash_move_outs",
      "wh_flash_move_outs",
      {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: limit,
        _offset: 0,
      },
      !!organizationId,
    ),
  );
}

export type FlashNoticeRow = {
  source_id: string;
  community_id: string | null;
  resident_source_id: string | null;
  person_name: string | null;
  notice_date: string | null;
  expected_move_out_date: string | null;
  care_type: string | null;
  unit_label: string | null;
  reason: string | null;
};

export function useFlashNotices(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  limit = 200,
) {
  return useQuery(
    trackerQuery<FlashNoticeRow>(
      "wh_flash_notices",
      "wh_flash_notices",
      {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: limit,
        _offset: 0,
      },
      !!organizationId,
    ),
  );
}

export type FlashDepositRow = {
  source_id: string;
  community_id: string | null;
  depositor_key: string | null;
  prospect_source_id: string | null;
  person_name: string | null;
  deposit_date: string | null;
  amount: number | null;
  expected_move_in_date: string | null;
  care_type: string | null;
  unit_label: string | null;
};

export function useFlashDeposits(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  limit = 200,
) {
  return useQuery(
    trackerQuery<FlashDepositRow>(
      "wh_flash_deposits",
      "wh_flash_deposits",
      {
        _org_id: organizationId,
        _start: start,
        _end: end,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: limit,
        _offset: 0,
      },
      !!organizationId,
    ),
  );
}

/**
 * Current-state Hot working list. Never filtered by inquiry date, month or
 * the selected Flash week — a prospect scored Hot today belongs on today's
 * tracker regardless of when it was created.
 */
export type FlashHotLeadRow = {
  source_id: string;
  community_id: string | null;
  person_name: string | null;
  stage_id: string | null;
  stage_label: string | null;
  score_label: string | null;
  status: string | null;
  inquiry_date: string | null;
  next_activity_scheduled_at: string | null;
  next_activity_type: string | null;
  last_contact_at: string | null;
  counselor_id: string | null;
  counselor_name: string | null;
  lead_source_id: string | null;
  lead_source_label: string | null;
};

export function useFlashHotLeads(
  organizationId: string | null,
  communityIds: string[],
  limit = 200,
) {
  return useQuery(
    trackerQuery<FlashHotLeadRow>(
      "wh_flash_hot_leads",
      "wh_flash_hot_leads",
      {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
        _limit: limit,
        _offset: 0,
      },
      !!organizationId,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Manual Flash data (budgets, notes, networking entries)              */
/* ------------------------------------------------------------------ */

export type FlashBudgetRow = {
  id: string;
  organization_id: string;
  community_id: string;
  effective_start: string;
  effective_end: string | null;
  budget_occupied_units: number | null;
  budget_occupancy_pct: number | null;
  notes: string | null;
};

export function useFlashBudgets(organizationId: string | null) {
  return useQuery({
    queryKey: ["flash_budgets", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<FlashBudgetRow[]> => {
      const { data, error } = await db
        .from("flash_occupancy_budgets")
        .select("*")
        .eq("organization_id", organizationId)
        .order("effective_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FlashBudgetRow[];
    },
  });
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export function useSaveFlashBudget(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<FlashBudgetRow, "id" | "organization_id"> & { id?: string }) => {
      const payload = {
        ...input,
        organization_id: organizationId,
        created_by: await currentUserId(),
      };
      const { error } = await db.from("flash_occupancy_budgets").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash_budgets"] });
      qc.invalidateQueries({ queryKey: ["wh_flash_report"] });
    },
  });
}

export function useDeleteFlashBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("flash_occupancy_budgets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash_budgets"] });
      qc.invalidateQueries({ queryKey: ["wh_flash_report"] });
    },
  });
}

export type FlashEntryRow = {
  id: string;
  organization_id: string;
  community_id: string;
  entry_date: string;
  kind: string;
  title: string;
  target_audience: string | null;
  invited_count: number | null;
  attended_count: number | null;
  notes: string | null;
  reporting_month: string | null;
  reporting_week_start: string | null;
  created_by: string | null;
  created_at: string;
};

export function useFlashEntries(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
) {
  return useQuery({
    queryKey: ["flash_entries", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId,
    queryFn: async (): Promise<FlashEntryRow[]> => {
      let q = db
        .from("flash_manual_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("entry_date", start)
        .lte("entry_date", end)
        .order("entry_date", { ascending: true });
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as FlashEntryRow[];
    },
  });
}

export function useSaveFlashEntry(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<FlashEntryRow, "id" | "organization_id" | "created_by" | "created_at"> & {
        id?: string;
      },
    ) => {
      const { error } = await db.from("flash_manual_entries").upsert({
        ...input,
        organization_id: organizationId,
        created_by: await currentUserId(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flash_entries"] }),
  });
}

export function useDeleteFlashEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("flash_manual_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flash_entries"] }),
  });
}

export type FlashNoteRow = {
  id: string;
  organization_id: string;
  community_id: string;
  subject_type: string;
  subject_key: string;
  body: string;
  reporting_month: string | null;
  reporting_week_start: string | null;
  created_by: string | null;
  updated_at: string;
};

/** Manual Flash notes for a reporting month, keyed by `subject_type:subject_key`. */
export function useFlashNotes(
  organizationId: string | null,
  communityIds: string[],
  reportingMonth: string,
) {
  return useQuery({
    queryKey: ["flash_notes", organizationId, communityIds.join(","), reportingMonth],
    enabled: !!organizationId,
    queryFn: async (): Promise<Record<string, FlashNoteRow>> => {
      let q = db
        .from("flash_notes")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("reporting_month", reportingMonth);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q;
      if (error) throw error;
      const map: Record<string, FlashNoteRow> = {};
      for (const row of (data ?? []) as FlashNoteRow[]) {
        map[`${row.subject_type}:${row.subject_key}`] = row;
      }
      return map;
    },
  });
}

export function useSaveFlashNote(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      community_id: string;
      subject_type: string;
      subject_key: string;
      body: string;
      reporting_month: string;
      reporting_week_start: string;
    }) => {
      if (input.id) {
        const { error } = await db
          .from("flash_notes")
          .update({ body: input.body, updated_by: await currentUserId() })
          .eq("id", input.id);
        if (error) throw error;
        return;
      }
      const { error } = await db.from("flash_notes").insert({
        ...input,
        organization_id: organizationId,
        created_by: await currentUserId(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flash_notes"] }),
  });
}
