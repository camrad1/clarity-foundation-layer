import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Database } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { StatusPill } from "@/components/clarity/status-pill";
import { supabase } from "@/integrations/supabase/client";
import { useConnections, useSourceTypes } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/data-sources")({
  head: () => ({
    meta: [
      { title: "Data Sources — ClarityIQ Admin" },
      {
        name: "description",
        content: "Register and monitor the marketing, CRM and occupancy connections feeding ClarityIQ.",
      },
      { property: "og:title", content: "Data Sources — ClarityIQ Admin" },
      { property: "og:description", content: "Connection registry and freshness for every ClarityIQ source." },
    ],
  }),
  component: DataSources,
});

function fmt(d: string | null) {
  return d ? format(new Date(d), "MMM d, yyyy h:mm a") : "Never";
}

function DataSources() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const connections = useConnections(organizationId);
  const sourceTypes = useSourceTypes();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Data Sources"
        description="Credentials are stored server-side only and are never readable by the browser. Registering a connection defines what ClarityIQ expects to receive."
        actions={
          <RecordFormDialog
            title="Register connection"
            submitLabel="Add connection"
            fields={[
              {
                name: "source_type",
                label: "Source type",
                type: "select",
                required: true,
                options: (sourceTypes.data ?? []).map((s) => ({ value: s.key, label: s.name })),
              },
              { name: "display_name", label: "Display name", required: true },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("data_source_connections").insert({
                organization_id: organizationId,
                source_type: v("source_type"),
                display_name: v("display_name"),
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["connections", organizationId] });
            }}
          />
        }
      />

      <DataTable
        loading={connections.isLoading}
        rows={connections.data ?? []}
        empty={
          <EmptyState
            icon={<Database className="size-6" />}
            title="No connections registered"
            description="Register Search Console, WelcomeHome or Further so Phase 1 ingestion has a target."
          />
        }
        columns={[
          {
            key: "name",
            header: "Connection",
            render: (r) => (
              <div>
                <p className="font-medium">{r.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {(sourceTypes.data ?? []).find((s) => s.key === r.source_type)?.name ??
                    r.source_type}
                </p>
              </div>
            ),
          },
          { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "last_success",
            header: "Last successful sync",
            render: (r) => fmt(r.last_successful_sync_at),
          },
          {
            key: "through",
            header: "Data through",
            render: (r) => (r.data_through_date ? format(new Date(r.data_through_date), "MMM d, yyyy") : "—"),
          },
        ]}
      />
    </div>
  );
}
