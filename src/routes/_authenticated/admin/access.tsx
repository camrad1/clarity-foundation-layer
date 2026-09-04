import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  ASSIGNABLE_ORG_ROLES,
  ROLE_LABELS,
  roleScopeLabel,
  useCommunities,
  useOrgRole,
  useRegions,
  type AppRole,
} from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/access")({
  head: () => ({
    meta: [
      { title: "Users & Access — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content: "Roles and community-level access scopes controlling what each ClarityIQ user can see.",
      },
      { property: "og:title", content: "Users & Access — ONELIFE Marketing Performance Hub Admin" },
      { property: "og:description", content: "Manage ClarityIQ roles and per-community data scopes." },
    ],
  }),
  component: Access,
});

type MemberRow = {
  id: string;
  user_id: string;
  role: string;
  email: string | null;
  full_name: string | null;
  communities: string[];
  regions: string[];
};

function useMembers(organizationId: string | null) {
  return useQuery({
    queryKey: ["org_members", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data: memberships, error } = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      const ids = (memberships ?? []).map((m) => m.user_id);
      if (!ids.length) return [];

      const [{ data: profiles }, { data: access }, { data: regionAccess }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name").in("id", ids),
        supabase
          .from("user_community_access")
          .select("user_id, communities(name)")
          .eq("organization_id", organizationId!),
        supabase
          .from("user_region_access")
          .select("user_id, regions(name)")
          .eq("organization_id", organizationId!),
      ]);

      return (memberships ?? []).map((m) => {
        const profile = (profiles ?? []).find((p) => p.id === m.user_id);
        return {
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          email: profile?.email ?? null,
          full_name: profile?.full_name ?? null,
          communities: (access ?? [])
            .filter((a) => a.user_id === m.user_id)
            .map((a) => (a.communities as { name: string } | null)?.name ?? "")
            .filter(Boolean),
          regions: (regionAccess ?? [])
            .filter((a) => a.user_id === m.user_id)
            .map((a) => (a.regions as { name: string } | null)?.name ?? "")
            .filter(Boolean),
        };
      });
    },
  });
}

function Access() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { isOrgAdmin, isPlatformAdmin } = useOrgRole(organizationId);
  const members = useMembers(organizationId);
  const communities = useCommunities(organizationId);
  const regions = useRegions(organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users & Access"
        description="Roles set what a user can do; region and community access set what they can see. Scoped users only ever receive rows for their assigned scope — enforced in the database, not the interface. Platform administrator status can only be granted by an existing platform administrator."
        actions={
          <RecordFormDialog
            title="Grant community access"
            submitLabel="Grant access"
            description="Assign a community to an existing member of this organization."
            fields={[
              {
                name: "user_id",
                label: "Member",
                type: "select",
                required: true,
                options: (members.data ?? []).map((m) => ({
                  value: m.user_id,
                  label: m.full_name || m.email || m.user_id.slice(0, 8),
                })),
              },
              {
                name: "community_id",
                label: "Community",
                type: "select",
                required: true,
                options: (communities.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("user_community_access").insert({
                organization_id: organizationId,
                user_id: v("user_id"),
                community_id: v("community_id"),
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["org_members", organizationId] });
            }}
          />
        }
      />

      <DataTable<MemberRow>
        loading={members.isLoading}
        rows={members.data ?? []}
        empty={
          <EmptyState
            icon={<Users className="size-6" />}
            title="No members yet"
            description="Members appear here once they are added to this organization."
          />
        }
        columns={[
          {
            key: "user",
            header: "User",
            render: (r) => (
              <div>
                <p className="font-medium">{r.full_name || "Unnamed user"}</p>
                <p className="text-xs text-muted-foreground">{r.email ?? r.user_id.slice(0, 8)}</p>
              </div>
            ),
          },
          {
            key: "role",
            header: "Role",
            render: (r) => {
              const isPlatform = r.role === "platform_admin";
              // Only platform admins may view or change platform admin membership.
              if (!isOrgAdmin || (isPlatform && !isPlatformAdmin)) {
                return <span>{ROLE_LABELS[r.role as AppRole] ?? r.role}</span>;
              }
              const options = isPlatformAdmin
                ? ([...ASSIGNABLE_ORG_ROLES, "platform_admin"] as AppRole[])
                : ASSIGNABLE_ORG_ROLES;
              return (
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  value={r.role}
                  onChange={async (e) => {
                    const { error } = await supabase
                      .from("organization_memberships")
                      .update({ role: e.target.value as never })
                      .eq("id", r.id);
                    if (!error)
                      await qc.invalidateQueries({ queryKey: ["org_members", organizationId] });
                  }}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {ROLE_LABELS[o]}
                    </option>
                  ))}
                </select>
              );
            },
          },
          {
            key: "scope",
            header: "Data scope",
            render: (r) => roleScopeLabel(r.role, r.regions, r.communities),
          },
        ]}
      />

      {regions.data?.length ? null : null}
    </div>
  );
}
