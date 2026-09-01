import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Signal } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCareTypes, useCommunities, useUrlRules } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/url-rules")({
  head: () => ({
    meta: [
      { title: "URL Mapping Rules — ClarityIQ Admin" },
      {
        name: "description",
        content: "Associate website URLs and content types with canonical ClarityIQ communities.",
      },
      { property: "og:title", content: "URL Mapping Rules — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Rules that resolve page URLs to communities, content types and intent.",
      },
    ],
  }),
  component: UrlRules,
});

type RuleRow = {
  id: string;
  match_type: string;
  pattern: string;
  content_type: string;
  intent_type: string | null;
  topic: string | null;
  priority: number;
  active: boolean;
  communities: { id: string; name: string } | null;
};

const MATCH_TYPES = [
  { value: "exact_url", label: "Exact URL" },
  { value: "url_contains", label: "URL contains" },
  { value: "path_prefix", label: "Path prefix" },
  { value: "regex", label: "Regex" },
];

const CONTENT_TYPES = [
  "community",
  "blog",
  "service",
  "resource",
  "corporate",
  "pricing",
  "other",
].map((v) => ({ value: v, label: v }));

function UrlRules() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const rules = useUrlRules(organizationId);
  const communities = useCommunities(organizationId);
  const careTypes = useCareTypes(organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="URL Mapping Rules"
        description="The framework that resolves website URLs to communities and content classes. The SEO classification engine itself is a later phase — these rules are its inputs."
        actions={
          <RecordFormDialog
            title="New URL rule"
            submitLabel="Add rule"
            fields={[
              { name: "match_type", label: "Match type", type: "select", required: true, options: MATCH_TYPES },
              { name: "pattern", label: "Pattern", required: true, placeholder: "/the-laurel-at-vernon-hills/" },
              { name: "content_type", label: "Content type", type: "select", options: CONTENT_TYPES },
              {
                name: "community_id",
                label: "Community",
                type: "select",
                options: (communities.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                help: "Leave empty for non-community pages such as corporate or blog content.",
              },
              {
                name: "care_type_id",
                label: "Care type",
                type: "select",
                options: (careTypes.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              },
              { name: "intent_type", label: "Intent" },
              { name: "topic", label: "Topic" },
              { name: "priority", label: "Priority", type: "number", placeholder: "100" },
            ]}
            onSubmit={async (v) => {
              if (!organizationId) throw new Error("Select an organization first");
              const { error } = await supabase.from("url_mapping_rules").insert({
                organization_id: organizationId,
                match_type: v("match_type") as never,
                pattern: v("pattern"),
                content_type: v("content_type") || "other",
                community_id: v("community_id") || null,
                care_type_id: v("care_type_id") || null,
                intent_type: v("intent_type") || null,
                topic: v("topic") || null,
                priority: v("priority") ? Number(v("priority")) : 100,
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["url_rules", organizationId] });
            }}
          />
        }
      />

      <DataTable<RuleRow>
        loading={rules.isLoading}
        rows={(rules.data ?? []) as unknown as RuleRow[]}
        empty={
          <EmptyState
            icon={<Signal className="size-6" />}
            title="No URL rules yet"
            description="Add rules so search and website data can be attributed to the right community and content type."
          />
        }
        columns={[
          { key: "priority", header: "Priority", render: (r) => r.priority },
          {
            key: "match",
            header: "Match",
            render: (r) => (
              <div>
                <p className="font-mono text-xs">{r.pattern}</p>
                <p className="text-xs text-muted-foreground">
                  {MATCH_TYPES.find((m) => m.value === r.match_type)?.label}
                </p>
              </div>
            ),
          },
          { key: "content", header: "Content type", render: (r) => r.content_type },
          { key: "community", header: "Community", render: (r) => r.communities?.name ?? "—" },
          { key: "intent", header: "Intent", render: (r) => r.intent_type ?? "—" },
          { key: "active", header: "Active", render: (r) => (r.active ? "Yes" : "No") },
        ]}
      />
    </div>
  );
}
