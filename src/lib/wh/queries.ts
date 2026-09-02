import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Browser reads of the WelcomeHome analytics copies.
 *
 * Every read goes through the RLS-scoped browser client: organization and
 * community isolation is enforced by the database, never by these filters.
 * The community id filter below is presentation only.
 */

export type WhConnection = {
  id: string;
  organization_id: string;
  display_name: string;
  status: string;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  data_through_date: string | null;
  connection_metadata: Record<string, unknown>;
};

export function useWhConnection(organizationId: string | null) {
  return useQuery({
    queryKey: ["wh_connection", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhConnection | null> => {
      const { data, error } = await supabase
        .from("data_source_connections")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("source_type", "welcomehome")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as WhConnection | null) ?? null;
    },
  });
}

export function useWhSourceCommunities(connectionId: string | null) {
  return useQuery({
    queryKey: ["wh_source_communities", connectionId],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_source_communities")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Bounded lookup read.
 *
 * `lookupTypes` narrows the fetch to the dimensions a screen actually needs.
 * This matters: the Referrers dimension alone is ~900 rows, so an unfiltered
 * read hit PostgREST's default 1000-row ceiling and silently truncated the
 * lead_source / stage / user rows that label resolution depends on.
 */
export function useWhLookups(connectionId: string | null, lookupTypes?: string | string[]) {
  const types = lookupTypes == null ? null : Array.isArray(lookupTypes) ? lookupTypes : [lookupTypes];
  return useQuery({
    queryKey: ["wh_lookups", connectionId, types ? types.join(",") : "all"],
    enabled: !!connectionId,
    queryFn: async () => {
      let q = supabase
        .from("wh_lookups")
        .select("id, lookup_type, source_id, label")
        .eq("connection_id", connectionId!);
      if (types) q = types.length === 1 ? q.eq("lookup_type", types[0]!) : q.in("lookup_type", types);
      const { data, error } = await q.order("label").range(0, 4999);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Referential coverage of label lookups over normalized WelcomeHome facts.
 * Server-side and tenant/community authorized: no fact rows reach the browser.
 */
export function useWhLookupCoverage(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_lookup_coverage", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wh_lookup_coverage", {
        _org_id: organizationId!,
        ...(communityIds.length ? { _community_ids: communityIds } : {}),
      });

      if (error) throw error;
      return (data ?? []) as {
        lookup_type: string;
        referenced: number;
        resolved: number;
        unresolved: number;
        unresolved_ids: string[];
      }[];
    },
  });
}


export function useWhActivityMappings(connectionId: string | null) {
  return useQuery({
    queryKey: ["wh_activity_mappings", connectionId],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_activity_type_mappings")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("activity_type_label");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWhScoreMappings(connectionId: string | null) {
  return useQuery({
    queryKey: ["wh_score_mappings", connectionId],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_score_mappings")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("score_label");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type WhSettings = {
  organization_id: string;
  inquiry_date_field: string;
  move_in_date_field: string;
  move_out_date_field: string;
  deposit_source: string;
  stalled_threshold_days: number;
  hot_no_activity_mode: string;
  exclude_merged_prospects: boolean;
  exclude_discarded_prospects: boolean;
  incremental_overlap_minutes: number;
  daily_snapshots_state: string;
};

export const WH_DEFAULT_SETTINGS: Omit<WhSettings, "organization_id"> = {
  inquiry_date_field: "created_at_source",
  move_in_date_field: "move_in_date",
  move_out_date_field: "move_out_date",
  deposit_source: "deposit_transactions",
  stalled_threshold_days: 14,
  hot_no_activity_mode: "none_scheduled",
  exclude_merged_prospects: true,
  exclude_discarded_prospects: true,
  incremental_overlap_minutes: 120,
  daily_snapshots_state: "not_configured",
};

export function useWhSettings(organizationId: string | null) {
  return useQuery({
    queryKey: ["wh_settings", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhSettings> => {
      const { data, error } = await supabase
        .from("wh_settings")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as WhSettings | null) ?? {
          organization_id: organizationId!,
          ...WH_DEFAULT_SETTINGS,
        }
      );
    },
  });
}

export function useWhSyncState(connectionId: string | null) {
  return useQuery({
    queryKey: ["wh_sync_state", connectionId],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_sync_state")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("source_table");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWhTableRuns(connectionId: string | null, limit = 60) {
  return useQuery({
    queryKey: ["wh_table_runs", connectionId, limit],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wh_sync_table_runs")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWhCommunityMappings(organizationId: string | null) {
  return useQuery({
    queryKey: ["wh_community_mappings", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_source_mappings")
        .select("*, communities(id, name, timezone)")
        .eq("organization_id", organizationId!)
        .eq("source_type", "welcomehome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Fact reads
// ---------------------------------------------------------------------------
//
// Deliberately absent. Dashboard KPIs are computed by the database (see
// ./summary.ts): the browser must never download prospect, activity, contract,
// deposit, unit or touchpoint rows in order to count them. A client-side count
// is silently capped by the API row limit and therefore cannot be correct at
// 2,000 / 50,000 / 500,000 rows. Record-level access is paginated through
// wh_prospect_page.
