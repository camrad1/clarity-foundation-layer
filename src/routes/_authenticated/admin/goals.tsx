import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatDateOnly } from "@/lib/date-ranges";
import { Goal } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useMetricDefinitions, useMetricGoals } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/goals")({
  head: () => ({
    meta: [
      { title: "Goals — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content: "Effective-dated performance targets per metric and community, used for variance reporting.",
      },
      { property: "og:title", content: "Goals — ONELIFE Marketing Performance Hub Admin" },
      { property: "og:description", content: "Set ClarityIQ metric targets by community and period." },
    ],
  }),
  component: Goals,
});

type GoalRow = {
  id: string;
  metric_key: string;
  target_value: number;
  effective_start: string;
  effective_end: string | null;
  notes: string | null;
  communities: { id: string; name: string } | null;
};

function Goals() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const goals = useMetricGoals(organizationId);
  const communities = useCommunities(organizationId);
  const metrics = useMetricDefinitions();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Goals"
        description="Targets are effective-dated so historical variance is always measured against the goal that was in force at the time."
        actions={
          <RecordFormDialog
            title="New goal"
            submitLabel="Add goal"
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
                help: "Leave empty for an organization-wide target.",
              },
              { name: "target_value", label: "Target value", type: "number", required: true },
              { name: "effective_start", label: "Effective from", type: "date", required: true },
              { name: "effective_end", label: "Effective to", type: "date" },
              { name: "notes", label: "Notes", type: "textarea" },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("metric_goals").insert({
                organization_id: organizationId,
                metric_key: v("metric_key"),
                community_id: v("community_id") || null,
                target_value: Number(v("target_value")),
                effective_start: v("effective_start"),
                effective_end: v("effective_end") || null,
                notes: v("notes") || null,
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["metric_goals", organizationId] });
            }}
          />
        }
      />

      <DataTable<GoalRow>
        loading={goals.isLoading}
        rows={(goals.data ?? []) as unknown as GoalRow[]}
        empty={
          <EmptyState
            icon={<Goal className="size-6" />}
            title="No goals set"
            description="Add targets once the metrics they measure are live in the registry."
          />
        }
        columns={[
          {
            key: "metric",
            header: "Metric",
            render: (r) =>
              (metrics.data ?? []).find((m) => m.metric_key === r.metric_key)?.name ?? r.metric_key,
          },
          { key: "scope", header: "Scope", render: (r) => r.communities?.name ?? "Organization-wide" },
          { key: "target", header: "Target", align: "right", render: (r) => r.target_value },
          {
            key: "period",
            header: "Effective",
            render: (r) =>
              `${formatDateOnly(r.effective_start)} – ${
                r.effective_end ? formatDateOnly(r.effective_end) : "ongoing"
              }`,
          },
        ]}
      />
    </div>
  );
}
