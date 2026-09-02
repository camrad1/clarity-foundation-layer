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

export function useWhLookups(connectionId: string | null, lookupType?: string) {
  return useQuery({
    queryKey: ["wh_lookups", connectionId, lookupType ?? "all"],
    enabled: !!connectionId,
    queryFn: async () => {
      let q = supabase
        .from("wh_lookups")
        .select("id, lookup_type, source_id, label")
        .eq("connection_id", connectionId!);
      if (lookupType) q = q.eq("lookup_type", lookupType);
      const { data, error } = await q.order("label");
      if (error) throw error;
      return data ?? [];
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

export type WhProspect = {
  id: string;
  source_id: string;
  community_id: string | null;
  status: string | null;
  stage_id: string | null;
  score_id: string | null;
  lead_source_id: string | null;
  current_sales_counselor_id: string | null;
  created_at_source: string | null;
  active_at: string | null;
  initial_contact_at: string | null;
  last_contact_at: string | null;
  next_activity_scheduled_at: string | null;
  merged_into_prospect_id: string | null;
  discarded_at: string | null;
  metadata: Record<string, unknown> | null;
};

const PROSPECT_COLS =
  "id, source_id, community_id, status, stage_id, score_id, lead_source_id, current_sales_counselor_id, created_at_source, active_at, initial_contact_at, last_contact_at, next_activity_scheduled_at, merged_into_prospect_id, discarded_at, metadata";

export function useWhProspects(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_prospects", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhProspect[]> => {
      let q = supabase
        .from("wh_prospects")
        .select(PROSPECT_COLS)
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as unknown as WhProspect[];
    },
  });
}

export type WhActivity = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  activity_type_id: string | null;
  user_id_source: string | null;
  completed_at: string | null;
  completed_local_date: string | null;
  discarded_at: string | null;
};

export function useWhActivities(
  organizationId: string | null,
  communityIds: string[],
  start?: string,
  end?: string,
) {
  return useQuery({
    queryKey: ["wh_activities", organizationId, communityIds.join(","), start, end],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhActivity[]> => {
      let q = supabase
        .from("wh_activities")
        .select(
          "id, source_id, community_id, prospect_source_id, activity_type_id, user_id_source, completed_at, completed_local_date, discarded_at",
        )
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      if (start) q = q.gte("completed_local_date", start);
      if (end) q = q.lte("completed_local_date", end);
      const { data, error } = await q.limit(50000);
      if (error) throw error;
      return (data ?? []) as unknown as WhActivity[];
    },
  });
}

export type WhContract = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  unit_source_id: string | null;
  status: string | null;
  care_type_id_source: string | null;
  move_in_date: string | null;
  financial_move_in_date: string | null;
  move_out_date: string | null;
  financial_move_out_date: string | null;
  notice_date: string | null;
  count_move_in: boolean | null;
  count_move_out: boolean | null;
  is_transfer: boolean | null;
  occupancy_point_factor: number | null;
  deposit_amount: number | null;
  deposit_received_date: string | null;
  sales_counselor_id: string | null;
};

export function useWhContracts(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_contracts", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhContract[]> => {
      let q = supabase
        .from("wh_housing_contracts")
        .select(
          "id, source_id, community_id, prospect_source_id, unit_source_id, status, care_type_id_source, move_in_date, financial_move_in_date, move_out_date, financial_move_out_date, notice_date, count_move_in, count_move_out, is_transfer, occupancy_point_factor, deposit_amount, deposit_received_date, sales_counselor_id",
        )
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as unknown as WhContract[];
    },
  });
}

export type WhDeposit = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  housing_contract_source_id: string | null;
  transaction_type: string | null;
  amount: number | null;
  occurred_local_date: string | null;
  refunded_at: string | null;
  discarded_at: string | null;
};

export function useWhDeposits(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_deposits", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhDeposit[]> => {
      let q = supabase
        .from("wh_deposit_transactions")
        .select(
          "id, source_id, community_id, prospect_source_id, housing_contract_source_id, transaction_type, amount, occurred_local_date, refunded_at, discarded_at",
        )
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as unknown as WhDeposit[];
    },
  });
}

export type WhUnit = {
  id: string;
  source_id: string;
  community_id: string | null;
  unit_number: string | null;
  care_type_id_source: string | null;
  off_census: boolean | null;
  status: string | null;
  occupancy_point_factor: number | null;
};

export function useWhUnits(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_units", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhUnit[]> => {
      let q = supabase
        .from("wh_units")
        .select(
          "id, source_id, community_id, unit_number, care_type_id_source, off_census, status, occupancy_point_factor",
        )
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as unknown as WhUnit[];
    },
  });
}

export type WhTouchpoint = {
  id: string;
  source_id: string;
  community_id: string | null;
  prospect_source_id: string | null;
  lead_source_id: string | null;
  campaign_name: string | null;
  occurred_local_date: string | null;
};

export function useWhTouchpoints(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_touchpoints", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<WhTouchpoint[]> => {
      let q = supabase
        .from("wh_marketing_touchpoints")
        .select(
          "id, source_id, community_id, prospect_source_id, lead_source_id, campaign_name, occurred_local_date",
        )
        .eq("organization_id", organizationId!);
      if (communityIds.length) q = q.in("community_id", communityIds);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as unknown as WhTouchpoint[];
    },
  });
}
