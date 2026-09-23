import { createFileRoute } from "@tanstack/react-router";
import { Ruler } from "lucide-react";
import { format } from "date-fns";
import { formatDateOnly } from "@/lib/date-ranges";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { useMetricDefinitions } from "@/lib/clarity-queries";

export const Route = createFileRoute("/_authenticated/admin/metrics")({
  head: () => ({
    meta: [
      { title: "Metric Registry — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Every ClarityIQ metric is versioned, dated and defined against a source table before it can be displayed.",
      },
      { property: "og:title", content: "Metric Registry — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Versioned, auditable metric definitions powering ClarityIQ calculations.",
      },
    ],
  }),
  component: Metrics,
});

function Metrics() {
  const metrics = useMetricDefinitions();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Metric Registry"
        description="Definitions are versioned and effective-dated. A metric can only surface in the product once its calculation is validated against source data — no invented KPIs."
      />

      <DataTable
        loading={metrics.isLoading}
        rows={metrics.data ?? []}
        empty={
          <EmptyState
            icon={<Ruler className="size-6" />}
            title="Registry is empty"
            description="Metric definitions are seeded per source as each ingestion pipeline lands."
          />
        }
        columns={[
          {
            key: "metric",
            header: "Metric",
            render: (r) => (
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.metric_key}</p>
              </div>
            ),
          },
          { key: "version", header: "Version", render: (r) => `v${r.metric_version}` },
          { key: "source", header: "Source", render: (r) => r.source_type ?? "—" },
          {
            key: "dimensions",
            header: "Dimensions",
            render: (r) => (r.supported_dimensions?.length ? r.supported_dimensions.join(", ") : "—"),
          },
          {
            key: "effective",
            header: "Effective from",
            render: (r) => formatDateOnly(r.effective_start),
          },
          { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "validation",
            header: "Validation",
            render: (r) => <StatusPill status={r.validation_status} />,
          },
        ]}
      />
    </div>
  );
}
