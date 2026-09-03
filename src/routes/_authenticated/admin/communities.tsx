import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { StatusPill } from "@/components/clarity/status-pill";
import { CommunityEditDialog } from "@/components/clarity/community-edit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useRegions } from "@/lib/clarity-queries";
import { COMMON_TIMEZONES, isValidTimezone, timezoneLabel } from "@/lib/timezones";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/communities")({
  head: () => ({
    meta: [
      { title: "Communities — ClarityIQ Admin" },
      {
        name: "description",
        content: "Canonical community records that every external data source resolves to.",
      },
      { property: "og:title", content: "Communities — ClarityIQ Admin" },
      { property: "og:description", content: "Manage canonical ClarityIQ communities and regions." },
    ],
  }),
  component: Communities,
});

function Communities() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const communities = useCommunities(organizationId);
  const regions = useRegions(organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Communities"
        description="A community has one permanent ClarityIQ identifier. External systems map to it — ClarityIQ never relies on external names."
        actions={
          <div className="flex gap-2">
            <RecordFormDialog
              title="New region"
              submitLabel="Add region"
              description="Regions are an optional grouping used by the global community filter."
              trigger={undefined}
              fields={[
                { name: "name", label: "Region name", required: true },
                { name: "slug", label: "Slug", required: true },
              ]}
              onSubmit={async (v) => {
                if (!organizationId) throw new Error("Select an organization first");
                const { error } = await supabase
                  .from("regions")
                  .insert({ organization_id: organizationId, name: v("name"), slug: v("slug") });
                if (error) throw error;
                await qc.invalidateQueries({ queryKey: ["regions", organizationId] });
              }}
            />
            <RecordFormDialog
              title="New community"
              submitLabel="Add community"
              fields={[
                { name: "name", label: "Community name", required: true },
                { name: "slug", label: "Slug", required: true },
                { name: "city", label: "City" },
                { name: "state", label: "State" },
                {
                  name: "timezone",
                  label: "Reporting timezone",
                  type: "select",
                  required: true,
                  help: "Reporting periods are calculated in this community's timezone.",
                  options: COMMON_TIMEZONES.map((t) => ({
                    value: t.value,
                    label: `${t.label} — ${t.value}`,
                  })),
                },
                { name: "website_url", label: "Website URL" },
                { name: "primary_domain", label: "Primary domain" },
                { name: "unit_count", label: "Unit count", type: "number" },
                {
                  name: "region_id",
                  label: "Region",
                  type: "select",
                  options: (regions.data ?? []).map((r) => ({ value: r.id, label: r.name })),
                },
              ]}
              onSubmit={async (v) => {
                if (!organizationId) throw new Error("Select an organization first");
                const { error } = await supabase.from("communities").insert({
                  organization_id: organizationId,
                  name: v("name"),
                  slug: v("slug"),
                  city: v("city") || null,
                  state: v("state") || null,
                  timezone: (() => {
                    const tz = v("timezone");
                    if (!isValidTimezone(tz)) throw new Error("Select a supported reporting timezone");
                    return tz;
                  })(),
                  website_url: v("website_url") || null,
                  primary_domain: v("primary_domain") || null,
                  unit_count: v("unit_count") ? Number(v("unit_count")) : null,
                  region_id: v("region_id") || null,
                });
                if (error) throw error;
                await qc.invalidateQueries({ queryKey: ["communities", organizationId] });
              }}
            />
          </div>
        }
      />

      <DataTable
        loading={communities.isLoading}
        rows={communities.data ?? []}
        empty={
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No communities yet"
            description="Add the communities this organization operates. Every external identifier will map back to these canonical records."
          />
        }
        columns={[
          {
            key: "name",
            header: "Community",
            render: (r) => (
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}…</p>
              </div>
            ),
          },
          {
            key: "location",
            header: "Location",
            render: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—",
          },
          {
            key: "region",
            header: "Region",
            render: (r) =>
              (regions.data ?? []).find((x) => x.id === r.region_id)?.name ?? "—",
          },
          {
            key: "tz",
            header: "Timezone",
            render: (r) => (
              <div>
                <p>{timezoneLabel(r.timezone)}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.timezone}</p>
              </div>
            ),
          },
          { key: "units", header: "Units", align: "right", render: (r) => r.unit_count ?? "—" },
          { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "edit",
            header: "",
            align: "right",
            render: (r) => (
              <CommunityEditDialog
                community={r as never}
                regions={(regions.data ?? []).map((x) => ({ id: x.id, name: x.name }))}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
