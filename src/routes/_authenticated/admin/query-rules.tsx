import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  MATCH_TYPES,
  MATCH_TYPE_LABELS,
  type QueryClassification,
  type QueryMatchType,
} from "@/lib/gsc/classification";
import { useQueryClassificationRules } from "@/lib/gsc/queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/query-rules")({
  head: () => ({
    meta: [
      { title: "Query Classification Rules — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Define the deterministic rules that classify search queries as branded, local, cost or care-type intent.",
      },
      { property: "og:title", content: "Query Classification Rules — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Rule-driven query intent segmentation — nothing is inferred automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QueryRules,
});

type RuleRow = {
  id: string;
  name: string;
  match_type: QueryMatchType;
  pattern: string;
  classification: QueryClassification;
  secondary_tags: string[];
  priority: number;
  active: boolean;
};

function QueryRules() {
  const { organizationId } = useAppState();
  const rules = useQueryClassificationRules(organizationId);
  const qc = useQueryClient();

  const rows = (rules.data ?? []) as unknown as RuleRow[];

  const columns: Column<RuleRow>[] = [
    { key: "priority", header: "Priority", render: (r) => r.priority },
    { key: "name", header: "Rule", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "match", header: "Match", render: (r) => MATCH_TYPE_LABELS[r.match_type] },
    {
      key: "pattern",
      header: "Pattern",
      render: (r) => <code className="text-xs text-muted-foreground">{r.pattern}</code>,
    },
    {
      key: "classification",
      header: "Classification",
      render: (r) => <Badge variant="secondary">{CLASSIFICATION_LABELS[r.classification]}</Badge>,
    },
    {
      key: "active",
      header: "Status",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            const { error } = await supabase
              .from("gsc_query_classification_rules")
              .update({ active: !r.active })
              .eq("id", r.id);
            if (error) toast.error(error.message);
            else await qc.invalidateQueries({ queryKey: ["gsc_query_rules"] });
          }}
        >
          {r.active ? "Active" : "Inactive"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Query Classification Rules"
        description="Rules are evaluated in priority order and the first match wins. Queries that match no rule stay unclassified — ClarityIQ never guesses that a query is branded or local."
        actions={
          <RecordFormDialog
            title="New classification rule"
            description="Applies to all Search Console queries for this organization."
            submitLabel="Create rule"
            fields={[
              { name: "name", label: "Rule name", required: true, placeholder: "Brand name" },
              {
                name: "match_type",
                label: "Match type",
                type: "select",
                required: true,
                options: MATCH_TYPES.map((m) => ({ value: m, label: MATCH_TYPE_LABELS[m] })),
              },
              {
                name: "pattern",
                label: "Pattern",
                required: true,
                help: "Matched against the lower-cased, whitespace-normalised query.",
              },
              {
                name: "classification",
                label: "Classification",
                type: "select",
                required: true,
                options: CLASSIFICATIONS.map((c) => ({
                  value: c,
                  label: CLASSIFICATION_LABELS[c],
                })),
              },
              {
                name: "priority",
                label: "Priority",
                type: "number",
                help: "Lower numbers are evaluated first.",
              },
            ]}
            onSubmit={async (get) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("gsc_query_classification_rules").insert({
                organization_id: organizationId,
                name: get("name"),
                match_type: (get("match_type") || "contains") as QueryMatchType,
                pattern: get("pattern"),
                classification: get("classification") as QueryClassification,
                priority: Number(get("priority") || 100),
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["gsc_query_rules"] });
            }}
          />
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={rules.isLoading}
        empty={
          <EmptyState
            icon={<Tags className="size-6" />}
            title="No classification rules yet"
            description="Until rules exist, every query is reported as unclassified and intent segments stay empty."
          />
        }
      />
    </div>
  );
}
