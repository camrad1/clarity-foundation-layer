import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Building2 } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { StatusPill } from "@/components/clarity/status-pill";
import { COMMON_TIMEZONES, isValidTimezone, timezoneLabel } from "@/lib/timezones";
import { supabase } from "@/integrations/supabase/client";
import { useIsPlatformAdmin, useOrganizations } from "@/lib/clarity-queries";

export const Route = createFileRoute("/_authenticated/admin/organizations")({
  head: () => ({
    meta: [
      { title: "Organizations — ClarityIQ Admin" },
      { name: "description", content: "Platform administration of ClarityIQ customer organizations." },
      { property: "og:title", content: "Organizations — ClarityIQ Admin" },
      { property: "og:description", content: "Manage tenant organizations on the ClarityIQ platform." },
    ],
  }),
  component: Organizations,
});

function Organizations() {
  const qc = useQueryClient();
  const orgs = useOrganizations();
  const { isPlatformAdmin } = useIsPlatformAdmin();

  if (!isPlatformAdmin) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Admin" title="Organizations" />
        <EmptyState
          title="Platform administration only"
          description="Managing tenant organizations requires the platform_admin role."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Platform admin"
        title="Organizations"
        description="Each organization is an isolated tenant. Data can never cross an organization boundary."
        actions={
          <RecordFormDialog
            title="New organization"
            submitLabel="Create organization"
            fields={[
              { name: "name", label: "Name", required: true },
              {
                name: "slug",
                label: "Slug",
                required: true,
                help: "Lowercase identifier, unique across the platform.",
              },
              {
                name: "default_timezone",
                label: "Default timezone",
                type: "select",
                required: true,
                help: "Communities may override this individually.",
                options: COMMON_TIMEZONES.map((t) => ({
                  value: t.value,
                  label: `${t.label} — ${t.value}`,
                })),
              },
            ]}
            onSubmit={async (v) => {
              const { error } = await supabase.from("organizations").insert({
                name: v("name"),
                slug: v("slug"),
                default_timezone: (() => {
                  const tz = v("default_timezone");
                  if (!isValidTimezone(tz)) throw new Error("Select a supported default timezone");
                  return tz;
                })(),
              });
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ["organizations"] });
            }}
          />
        }
      />
      <DataTable
        loading={orgs.isLoading}
        rows={orgs.data ?? []}
        empty={
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No organizations yet"
            description="Create the first customer organization to begin onboarding communities."
          />
        }
        columns={[
          { key: "name", header: "Organization", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "slug", header: "Slug", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
          { key: "tz", header: "Default timezone", render: (r) => `${timezoneLabel(r.default_timezone)} — ${r.default_timezone}` },
          { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "created",
            header: "Created",
            render: (r) => format(new Date(r.created_at), "MMM d, yyyy"),
          },
        ]}
      />
    </div>
  );
}
