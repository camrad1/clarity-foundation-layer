import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatDateOnly } from "@/lib/date-ranges";
import { GitCompareArrows } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { GscValidation } from "@/components/clarity/gsc-validation";
import { WhValidationEvidence, WhValidationQueue } from "@/components/clarity/wh-validation";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { StatusPill } from "@/components/clarity/status-pill";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useMetricDefinitions, useValidationChecks } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/validation")({
  head: () => ({
    meta: [
      { title: "Validation Center — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Compare ClarityIQ calculated metrics against source-system values before a metric is trusted.",
      },
      { property: "og:title", content: "Validation Center — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Side-by-side metric validation against source-of-truth reporting.",
      },
    ],
  }),
  component: Validation,
});

type CheckRow = {
  id: string;
  metric_key: string;
  metric_version: number | null;
  period_start: string;
  period_end: string;
  calculated_value: number | null;
  expected_value: number | null;
  difference: number | null;
  status: string;
  communities: { id: string; name: string } | null;
};

function Validation() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const checks = useValidationChecks(organizationId);
  const communities = useCommunities(organizationId);
  const metrics = useMetricDefinitions();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Validation Center"
        description="A metric moves to validated only when its calculated value matches the source system for the same period. Every check is retained as an audit record."
        actions={
          <RecordFormDialog
            title="New validation check"
            submitLabel="Record check"
            fields={[
              {
                name: "metric_key",
                label: "Metric",
                type: "select",
                required: true,
                options: (metrics.data ?? []).map((m) => ({ value: m.metric_key, label: m.name })),
              },
              {
                name: "community_id",
                label: "Community",
                type: "select",
                options: (communities.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              },
              { name: "period_start", label: "Period start", type: "date", required: true },
              { name: "period_end", label: "Period end", type: "date", required: true },
              { name: "expected_value", label: "Source-system value", type: "number" },
              { name: "calculated_value", label: "ClarityIQ value", type: "number" },
              { name: "reviewer_notes", label: "Notes", type: "textarea" },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const expected = v("expected_value") ? Number(v("expected_value")) : null;
              const calculated = v("calculated_value") ? Number(v("calculated_value")) : null;
              const { error } = await supabase.from("metric_validation_checks").insert({
                organization_id: organizationId,
                metric_key: v("metric_key"),
                community_id: v("community_id") || null,
                period_start: v("period_start"),
                period_end: v("period_end"),
                expected_value: expected,
                calculated_value: calculated,
                difference:
                  expected !== null && calculated !== null ? calculated - expected : null,
                reviewer_notes: v("reviewer_notes") || null,
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["validation_checks", organizationId] });
            }}
          />
        }
      />

      <GscValidation organizationId={organizationId} />

      <WhValidationEvidence />

      <WhValidationQueue />

      <h2 className="text-sm font-semibold text-foreground">Validation history</h2>

      <DataTable<CheckRow>
        loading={checks.isLoading}
        rows={(checks.data ?? []) as unknown as CheckRow[]}
        empty={
          <EmptyState
            icon={<GitCompareArrows className="size-6" />}
            title="No validation checks yet"
            description="Record a side-by-side comparison as soon as the first metric is calculated from real source data."
          />
        }
        columns={[
          {
            key: "metric",
            header: "Metric",
            render: (r) => (
              <div>
                <p className="font-medium">
                  {(metrics.data ?? []).find((m) => m.metric_key === r.metric_key)?.name ??
                    r.metric_key}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.communities?.name ?? "Organization-wide"}
                </p>
              </div>
            ),
          },
          {
            key: "period",
            header: "Period",
            render: (r) =>
              `${formatDateOnly(r.period_start, "MMM d")} – ${formatDateOnly(r.period_end)}`,
          },
          { key: "expected", header: "Source", align: "right", render: (r) => r.expected_value ?? "—" },
          {
            key: "calculated",
            header: "ClarityIQ",
            align: "right",
            render: (r) => r.calculated_value ?? "—",
          },
          { key: "diff", header: "Difference", align: "right", render: (r) => r.difference ?? "—" },
          { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
        ]}
      />
    </div>
  );
}
