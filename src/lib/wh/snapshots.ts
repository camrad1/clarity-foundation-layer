import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read access to the immutable daily snapshot history.
 *
 * Every value here comes from a stored snapshot row. Nothing is interpolated,
 * carried forward, or reconstructed from current-state data — a gap in the
 * history stays a gap.
 */

const db = supabase as any;

export type OccupancyTrendPoint = {
  period_start: string;
  snapshot_date: string;
  communities: number;
  census_units: number;
  occupied_units: number;
  vacant_units: number;
  notice_count: number;
  reserved_count: number;
  occupancy_pct: number | null;
  budget_units: number | null;
  budget_pct: number | null;
  variance_units: number | null;
};

export function useOccupancyTrend(
  organizationId: string | null,
  communityIds: string[],
  start: string,
  end: string,
  grain: "daily" | "weekly" | "monthly" = "daily",
) {
  return useQuery({
    queryKey: ["wh_occupancy_trend", organizationId, communityIds.join(","), start, end, grain],
    enabled: !!organizationId,
    queryFn: async (): Promise<OccupancyTrendPoint[]> => {
      const { data, error } = await db.rpc("wh_occupancy_trend", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
        _start: start,
        _end: end,
        _grain: grain,
      });
      if (error) throw error;
      return (data ?? []) as OccupancyTrendPoint[];
    },
  });
}

export type SnapshotHealthRow = {
  community_id: string;
  community_name: string;
  timezone: string | null;
  expected_snapshot_date: string;
  last_snapshot_date: string | null;
  last_snapshot_at: string | null;
  days_behind: number | null;
  snapshot_missing: boolean;
  last_failure_date: string | null;
  last_failure_reason: string | null;
  last_successful_sync_at: string | null;
  last_sync_status: string | null;
  source_stale: boolean;
  first_snapshot_date: string | null;
  snapshot_count: number;
};

export function useSnapshotHealth(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_snapshot_health", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<SnapshotHealthRow[]> => {
      const { data, error } = await db.rpc("wh_snapshot_health", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return (data ?? []) as SnapshotHealthRow[];
    },
  });
}

export type NightlyRun = {
  id: string;
  run_date: string;
  status: string;
  triggered_by: string;
  communities_total: number;
  communities_done: number;
  communities_failed: number;
  snapshots_written: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export function useNightlyRuns(organizationId: string | null, limit = 10) {
  return useQuery({
    queryKey: ["wh_nightly_runs", organizationId, limit],
    enabled: !!organizationId,
    refetchInterval: 15_000,
    queryFn: async (): Promise<NightlyRun[]> => {
      const { data, error } = await db
        .from("wh_nightly_runs")
        .select(
          "id, run_date, status, triggered_by, communities_total, communities_done, communities_failed, snapshots_written, started_at, finished_at, error",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as NightlyRun[];
    },
  });
}
