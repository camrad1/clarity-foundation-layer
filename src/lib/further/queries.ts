import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Browser reads of the Further source layer.
 *
 * Every read goes through the RLS-scoped browser client, so organization and
 * community isolation is enforced by the database. The API key is never
 * readable from the browser — only server functions can load it.
 */

export type FurtherConnection = {
  id: string;
  organization_id: string;
  display_name: string;
  status: string;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  data_through_date: string | null;
};

export function useFurtherConnection(organizationId: string | null) {
  return useQuery({
    queryKey: ["further_connection", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<FurtherConnection | null> => {
      const { data, error } = await supabase
        .from("data_source_connections")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("source_type", "further")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as FurtherConnection | null) ?? null;
    },
  });
}

export type FurtherSourceCommunity = {
  further_community_id: string;
  further_uuid: string | null;
  name: string | null;
  slug: string | null;
  url: string | null;
  community_id: string | null;
  discovered_at: string;
};

export function useFurtherSourceCommunities(connectionId: string | null) {
  return useQuery({
    queryKey: ["further_source_communities", connectionId],
    enabled: !!connectionId,
    queryFn: async (): Promise<FurtherSourceCommunity[]> => {
      const { data, error } = await supabase
        .from("further_communities")
        .select("further_community_id, further_uuid, name, slug, url, community_id, discovered_at")
        .eq("connection_id", connectionId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as FurtherSourceCommunity[];
    },
  });
}

export function useFurtherSyncState(connectionId: string | null) {
  return useQuery({
    queryKey: ["further_sync_state", connectionId],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("further_sync_state")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("dataset");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFurtherUnitRuns(connectionId: string | null, limit = 40) {
  return useQuery({
    queryKey: ["further_unit_runs", connectionId, limit],
    enabled: !!connectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("further_sync_unit_runs")
        .select("*")
        .eq("connection_id", connectionId!)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type FurtherCounts = {
  leads: number;
  visitors: number;
  events: number;
  details: number;
  matched: number;
  mappedCommunities: number;
  discoveredCommunities: number;
};

/** Exact head-count reads — no estimates, so the page never overstates coverage. */
export function useFurtherCounts(organizationId: string | null, connectionId: string | null) {
  return useQuery({
    queryKey: ["further_counts", organizationId, connectionId],
    enabled: !!organizationId,
    queryFn: async (): Promise<FurtherCounts> => {
      const head = async (table: string, filters: (q: any) => any) => {
        const { count, error } = await filters(
          supabase.from(table).select("id", { count: "exact", head: true }),
        );
        if (error) throw error;
        return count ?? 0;
      };
      const org = (q: any) => q.eq("organization_id", organizationId!);
      const [leads, visitors, events, details, matched, discovered, mapped] = await Promise.all([
        head("further_leads", org),
        head("further_visitors", org),
        head("further_conversation_events", org),
        head("further_lead_details", org),
        head("further_wh_matches", (q: any) => org(q).eq("is_active", true)),
        connectionId
          ? head("further_communities", (q: any) => q.eq("connection_id", connectionId))
          : Promise.resolve(0),
        head("community_source_mappings", (q: any) =>
          org(q).eq("source_type", "further").eq("active", true),
        ),
      ]);
      return {
        leads,
        visitors,
        events,
        details,
        matched,
        mappedCommunities: mapped,
        discoveredCommunities: discovered,
      };
    },
  });
}

/** Freshest row timestamps per dataset, for the connection page and Data Health. */
export function useFurtherFreshness(organizationId: string | null) {
  return useQuery({
    queryKey: ["further_freshness", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const latest = async (table: string, column: string) => {
        const { data, error } = await supabase
          .from(table)
          .select(column)
          .eq("organization_id", organizationId!)
          .order(column, { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return (data as any)?.[column] ?? null;
      };
      const [leads, visitors, events] = await Promise.all([
        latest("further_leads", "created_on"),
        latest("further_visitors", "occurred_at"),
        latest("further_conversation_events", "created_on"),
      ]);
      return { leads, visitors, events } as {
        leads: string | null;
        visitors: string | null;
        events: string | null;
      };
    },
  });
}

export function useFurtherMatchSummary(organizationId: string | null) {
  return useQuery({
    queryKey: ["further_match_summary", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("further_wh_matches")
        .select("wh_field, evidence_type, is_active, matched_at")
        .eq("organization_id", organizationId!)
        .order("matched_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = data ?? [];
      const active = rows.filter((r: any) => r.is_active);
      return {
        total: rows.length,
        active: active.length,
        field: (active[0] as any)?.wh_field ?? null,
        evidenceType: (active[0] as any)?.evidence_type ?? null,
        matchedAt: (active[0] as any)?.matched_at ?? null,
      };
    },
  });
}
