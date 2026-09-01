import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2 } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useCommunityMappings, useSourceTypes } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/mappings")({
  head: () => ({
    meta: [
      { title: "Community Mappings — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Map external system identifiers to canonical ClarityIQ communities so every source resolves consistently.",
      },
      { property: "og:title", content: "Community Mappings — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Resolve WelcomeHome, Further and Search Console identifiers to one community ID.",
      },
    ],
  }),
  component: Mappings,
});

type MappingRow = {
  id: string;
  source_type: string;
  external_id: string;
  external_name: string | null;
  active: boolean;
  community_id: string;
  communities: { id: string; name: string } | null;
};

function Mappings() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const mappings = useCommunityMappings(organizationId);
  const communities = useCommunities(organizationId);
  const sourceTypes = useSourceTypes();

  const rows = (mappings.data ?? []) as unknown as MappingRow[];
  const mappedIds = new Set(rows.filter((r) => r.active).map((r) => r.community_id));
  const unmapped = (communities.data ?? []).filter((c) => !mappedIds.has(c.id));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Community Mappings"
        description="Each external identifier resolves to exactly one canonical ClarityIQ community. Unmapped source records are never silently attributed."
        actions={
          <RecordFormDialog
            title="New mapping"
            submitLabel="Add mapping"
            fields={[
              {
                name: "source_type",
                label: "Source",
                type: "select",
                required: true,
                options: (sourceTypes.data ?? []).map((s) => ({ value: s.key, label: s.name })),
              },
              {
                name: "community_id",
                label: "ClarityIQ community",
                type: "select",
                required: true,
                options: (communities.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              },
              {
                name: "external_id",
                label: "External ID",
                required: true,
                help: "The identifier exactly as the source system reports it.",
              },
              { name: "external_name", label: "External name" },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("community_source_mappings").insert({
                organization_id: organizationId,
                community_id: v.community_id,
                source_type: v.source_type,
                external_id: v.external_id,
                external_name: v.external_name || null,
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["community_mappings", organizationId] });
            }}
          />
        }
      />

      {unmapped.length ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {unmapped.length} community{unmapped.length === 1 ? "" : "s"} has no active mapping
            </p>
            <p className="text-muted-foreground">
              {unmapped.map((c) => c.name).join(", ")}
            </p>
          </div>
        </div>
      ) : null}

      <DataTable<MappingRow>
        loading={mappings.isLoading}
        rows={rows}
        empty={
          <EmptyState
            icon={<Link2 className="size-6" />}
            title="No mappings yet"
            description="Add mappings so WelcomeHome, Further and website identifiers all resolve to the same canonical community."
          />
        }
        columns={[
          {
            key: "source",
            header: "Source",
            render: (r) =>
              (sourceTypes.data ?? []).find((s) => s.key === r.source_type)?.name ?? r.source_type,
          },
          {
            key: "external",
            header: "External identifier",
            render: (r) => (
              <div>
                <p className="font-mono text-xs">{r.external_id}</p>
                {r.external_name ? (
                  <p className="text-xs text-muted-foreground">{r.external_name}</p>
                ) : null}
              </div>
            ),
          },
          {
            key: "community",
            header: "ClarityIQ community",
            render: (r) => r.communities?.name ?? "—",
          },
          {
            key: "active",
            header: "Active",
            render: (r) => (r.active ? "Yes" : "No"),
          },
        ]}
      />
    </div>
  );
}
