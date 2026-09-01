import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * All reads go through the browser Supabase client, so row level security is
 * the enforcement boundary. The UI never filters for security — only for
 * presentation.
 */

export type MembershipRow = {
  id: string;
  organization_id: string;
  role: string;
  organizations: { id: string; name: string; slug: string; status: string } | null;
};

export function useMyMemberships() {
  return useQuery({
    queryKey: ["memberships"],
    queryFn: async (): Promise<MembershipRow[]> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("organization_memberships")
        .select("id, organization_id, role, organizations(id, name, slug, status)")
        .eq("user_id", uid);
      if (error) throw error;
      return (data ?? []) as MembershipRow[];
    },
  });
}

export function useIsPlatformAdmin() {
  const memberships = useMyMemberships();
  return {
    ...memberships,
    isPlatformAdmin: (memberships.data ?? []).some((m) => m.role === "platform_admin"),
  };
}

/**
 * Roles are the database `app_role` enum — never invent parallel role names.
 * Enforcement lives in RLS; these helpers only shape the interface.
 */
export const APP_ROLES = [
  "platform_admin",
  "organization_admin",
  "regional_user",
  "community_user",
  "marketing_user",
  "read_only",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Roles an organization admin is allowed to assign. platform_admin is excluded. */
export const ASSIGNABLE_ORG_ROLES: AppRole[] = [
  "organization_admin",
  "regional_user",
  "community_user",
  "marketing_user",
  "read_only",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  platform_admin: "Platform admin",
  organization_admin: "Organization admin",
  regional_user: "Regional user",
  community_user: "Community user",
  marketing_user: "Marketing user",
  read_only: "Read only",
};

/** Roles whose data scope is the whole organization. */
export const ORG_WIDE_ROLES: AppRole[] = [
  "platform_admin",
  "organization_admin",
  "marketing_user",
  "read_only",
];

export function roleScopeLabel(role: string, regions: string[], communities: string[]) {
  if (ORG_WIDE_ROLES.includes(role as AppRole)) return "All communities (organization-wide)";
  if (role === "regional_user")
    return regions.length ? regions.join(", ") : "No regions assigned";
  if (role === "community_user")
    return communities.length ? communities.join(", ") : "No communities assigned";
  return "—";
}

/** Current user's role in the active organization, plus admin capability flags. */
export function useOrgRole(organizationId: string | null) {
  const memberships = useMyMemberships();
  const rows = memberships.data ?? [];
  const isPlatformAdmin = rows.some((m) => m.role === "platform_admin");
  const role = (rows.find((m) => m.organization_id === organizationId)?.role ?? null) as
    | AppRole
    | null;
  return {
    loading: memberships.isLoading,
    role,
    isPlatformAdmin,
    isOrgAdmin: isPlatformAdmin || role === "organization_admin",
  };
}

export function useOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCommunities(organizationId: string | null) {
  return useQuery({
    queryKey: ["communities", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communities")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRegions(organizationId: string | null) {
  return useQuery({
    queryKey: ["regions", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regions")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCareTypes(organizationId: string | null) {
  return useQuery({
    queryKey: ["care_types", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("care_types").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSourceTypes() {
  return useQuery({
    queryKey: ["data_source_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("data_source_types").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConnections(organizationId: string | null) {
  return useQuery({
    queryKey: ["connections", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_source_connections")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSyncRuns(organizationId: string | null) {
  return useQuery({
    queryKey: ["sync_runs", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_sync_runs")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCommunityMappings(organizationId: string | null) {
  return useQuery({
    queryKey: ["community_mappings", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_source_mappings")
        .select("*, communities(id, name)")
        .eq("organization_id", organizationId!)
        .order("source_type");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUrlRules(organizationId: string | null) {
  return useQuery({
    queryKey: ["url_rules", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("url_mapping_rules")
        .select("*, communities(id, name)")
        .eq("organization_id", organizationId!)
        .order("priority");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMetricDefinitions() {
  return useQuery({
    queryKey: ["metric_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metric_definitions")
        .select("*")
        .order("metric_key");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMetricGoals(organizationId: string | null) {
  return useQuery({
    queryKey: ["metric_goals", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metric_goals")
        .select("*, communities(id, name)")
        .eq("organization_id", organizationId!)
        .order("effective_start", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useValidationChecks(organizationId: string | null) {
  return useQuery({
    queryKey: ["validation_checks", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metric_validation_checks")
        .select("*, communities(id, name)")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
