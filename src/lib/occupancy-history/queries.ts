import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read access to the official daily occupancy history backfill.
 *
 * These rows are the operator's authoritative pre-go-live record. Nightly
 * snapshots always win where both exist; nothing here is interpolated.
 */
const db = supabase as any;

export const OCC_HISTORY_CUTOFF = "2026-09-02";

export type OccHistoryHealthRow = {
  community_id: string;
  community_name: string;
  source_type: string;
  first_date: string | null;
  last_date: string | null;
  record_count: number;
  missing_days: number;
  warning_count: number;
  last_import_at: string | null;
};

export function useOccHistoryHealth(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["occ_history_health", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<OccHistoryHealthRow[]> => {
      const { data, error } = await db.rpc("occ_history_health", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as OccHistoryHealthRow[];
    },
  });
}

export type OccHistoryBatch = {
  id: string;
  source_file_name: string;
  source_sheet_name: string | null;
  source_year: number | null;
  source_range_start: string | null;
  source_range_end: string | null;
  cutoff_date: string;
  records_imported: number;
  rows_skipped: number;
  future_rows_skipped: number;
  unmapped_communities: string[];
  communities_imported: number;
  validation_warnings: number;
  imported_at: string;
};

export function useOccHistoryBatches(organizationId: string | null) {
  return useQuery({
    queryKey: ["occ_history_batches", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<OccHistoryBatch[]> => {
      const { data, error } = await db
        .from("occupancy_history_import_batches")
        .select(
          "id, source_file_name, source_sheet_name, source_year, source_range_start, source_range_end, cutoff_date, records_imported, rows_skipped, future_rows_skipped, unmapped_communities, communities_imported, validation_warnings, imported_at",
        )
        .eq("organization_id", organizationId)
        .order("imported_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OccHistoryBatch[];
    },
  });
}
