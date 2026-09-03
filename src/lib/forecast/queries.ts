import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { monthEnd, monthStart } from "./period";

/**
 * Forecast Tracker reads and writes.
 *
 * Weekly forecasts are point-in-time records. Row level security plus the
 * database trigger — not this module — decide who may correct a past week.
 */
const db = supabase as any;

export type ForecastEntry = {
  id: string;
  community_id: string;
  forecast_month: string;
  forecast_date: string;
  projected_move_ins: number | null;
  projected_move_outs: number | null;
  projected_net: number | null;
  stretch_goal: number | null;
  notes: string | null;
  historical_source_note: string | null;
  source_type: string;
  entered_at: string;
  updated_at: string;
};

export function useForecastEntries(organizationId: string | null, month: string) {
  return useQuery({
    queryKey: ["forecast_entries", organizationId, month],
    enabled: !!organizationId,
    queryFn: async (): Promise<ForecastEntry[]> => {
      const { data, error } = await db
        .from("forecast_weekly_entries")
        .select(
          "id, community_id, forecast_month, forecast_date, projected_move_ins, projected_move_outs, projected_net, stretch_goal, notes, historical_source_note, source_type, entered_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("forecast_month", monthStart(month))
        .order("forecast_date");
      if (error) throw error;
      return (data ?? []) as ForecastEntry[];
    },
  });
}

export type ForecastActualRow = {
  community_id: string;
  move_ins: number;
  move_outs: number;
  net_move_ins: number;
};

/** Validated month-end actuals per community — existing KPI definitions only. */
export function useForecastEomActuals(
  organizationId: string | null,
  month: string,
  communityIds: string[],
) {
  return useQuery({
    queryKey: ["forecast_eom_actuals", organizationId, month, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<ForecastActualRow[]> => {
      const { data, error } = await db.rpc("forecast_eom_actuals", {
        _org_id: organizationId,
        _start: monthStart(month),
        _end: monthEnd(month),
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as ForecastActualRow[];
    },
  });
}

export type ForecastRevision = {
  id: string;
  forecast_date: string;
  previous_move_ins: number | null;
  previous_move_outs: number | null;
  previous_stretch_goal: number | null;
  previous_notes: string | null;
  changed_at: string;
};

export function useForecastRevisions(entryId: string | null) {
  return useQuery({
    queryKey: ["forecast_revisions", entryId],
    enabled: !!entryId,
    queryFn: async (): Promise<ForecastRevision[]> => {
      const { data, error } = await db
        .from("forecast_entry_revisions")
        .select(
          "id, forecast_date, previous_move_ins, previous_move_outs, previous_stretch_goal, previous_notes, changed_at",
        )
        .eq("entry_id", entryId)
        .order("changed_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as ForecastRevision[];
    },
  });
}

export type ForecastInput = {
  organizationId: string;
  communityId: string;
  forecastDate: string;
  projectedMoveIns: number | null;
  projectedMoveOuts: number | null;
  stretchGoal: number | null;
  notes: string | null;
  entryId?: string | null;
};

export function useSaveForecast(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ForecastInput) => {
      const payload = {
        projected_move_ins: input.projectedMoveIns,
        projected_move_outs: input.projectedMoveOuts,
        stretch_goal: input.stretchGoal,
        notes: input.notes,
      };
      if (input.entryId) {
        const { error } = await db
          .from("forecast_weekly_entries")
          .update(payload)
          .eq("id", input.entryId);
        if (error) throw error;
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await db.from("forecast_weekly_entries").insert({
        organization_id: input.organizationId,
        community_id: input.communityId,
        forecast_month: monthStart(input.forecastDate),
        forecast_date: input.forecastDate,
        source_type: "manual",
        entered_by: auth.user?.id ?? null,
        ...payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["forecast_entries"] });
      void qc.invalidateQueries({ queryKey: ["forecast_revisions"] });
      void qc.invalidateQueries({ queryKey: ["forecast_entries", null, month] });
    },
  });
}

export type ForecastImportBatch = {
  id: string;
  source_file_name: string;
  source_sheet_name: string | null;
  forecast_dates_detected: number;
  communities_detected: number;
  records_imported: number;
  notes_imported: number;
  ambiguous_cells: number;
  rows_skipped: number;
  unmapped_communities: string[];
  imported_at: string;
};

export function useForecastImportBatches(organizationId: string | null) {
  return useQuery({
    queryKey: ["forecast_import_batches", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<ForecastImportBatch[]> => {
      const { data, error } = await db
        .from("forecast_import_batches")
        .select(
          "id, source_file_name, source_sheet_name, forecast_dates_detected, communities_detected, records_imported, notes_imported, ambiguous_cells, rows_skipped, unmapped_communities, imported_at",
        )
        .eq("organization_id", organizationId)
        .order("imported_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as ForecastImportBatch[];
    },
  });
}
