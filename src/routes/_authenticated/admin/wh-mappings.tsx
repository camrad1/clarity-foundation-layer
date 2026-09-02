import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useOrgRole } from "@/lib/clarity-queries";
import {
  useWhActivityMappings,
  useWhCommunityMappings,
  useWhConnection,
  useWhScoreMappings,
  useWhSettings,
  useWhSourceCommunities,
} from "@/lib/wh/queries";
import {
  WH_ACTIVITY_CATEGORIES,
  WH_ACTIVITY_CATEGORY_LABELS,
  WH_SCORE_LEVELS,
  WH_SCORE_LEVEL_LABELS,
} from "@/lib/wh/tables";
import { INQUIRY_DATE_FIELDS, MOVE_IN_DATE_FIELDS, MOVE_OUT_DATE_FIELDS } from "@/lib/wh/metrics";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/wh-mappings")({
  head: () => ({
    meta: [
      { title: "WelcomeHome Mapping — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Map WelcomeHome communities, activity types and scores onto ClarityIQ's canonical model.",
      },
      { property: "og:title", content: "WelcomeHome Mapping — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Community, activity type and score mapping plus provisional metric configuration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhMappings,
});

function WhMappings() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const communities = useCommunities(organizationId);
  const connection = useWhConnection(organizationId);
  const connectionId = connection.data?.id ?? null;
  const discovered = useWhSourceCommunities(connectionId);
  const mappings = useWhCommunityMappings(organizationId);
  const activityMappings = useWhActivityMappings(connectionId);
  const scoreMappings = useWhScoreMappings(connectionId);
  const settings = useWhSettings(organizationId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wh_community_mappings"] });
    qc.invalidateQueries({ queryKey: ["wh_activity_mappings"] });
    qc.invalidateQueries({ queryKey: ["wh_score_mappings"] });
    qc.invalidateQueries({ queryKey: ["wh_settings"] });
  };

  const setCommunityMapping = useMutation({
    mutationFn: async (args: { communityId: string; externalId: string | null; name: string | null }) => {
      const existing = (mappings.data ?? []).find((m: any) => m.community_id === args.communityId);
      if (!args.externalId) {
        if (existing) {
          const { error } = await supabase
            .from("community_source_mappings")
            .delete()
            .eq("id", (existing as any).id);
          if (error) throw error;
        }
        return;
      }
      const payload = {
        organization_id: organizationId!,
        community_id: args.communityId,
        source_type: "welcomehome",
        external_id: args.externalId,
        external_name: args.name,
        active: true,
      };
      const { error } = existing
        ? await supabase.from("community_source_mappings").update(payload).eq("id", (existing as any).id)
        : await supabase.from("community_source_mappings").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Community mapping saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setActivityCategory = useMutation({
    mutationFn: async (args: { id: string; category: (typeof WH_ACTIVITY_CATEGORIES)[number] }) => {
      const { error } = await supabase
        .from("wh_activity_type_mappings")
        .update({ category: args.category })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const setScoreLevel = useMutation({
    mutationFn: async (args: { id: string; level: (typeof WH_SCORE_LEVELS)[number] }) => {
      const { error } = await supabase
        .from("wh_score_mappings")
        .update({ level: args.level })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase
        .from("wh_settings")
        .upsert({ organization_id: organizationId!, ...settings.data, ...patch } as any, {
          onConflict: "organization_id",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuration saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canManageImports) {
    return (
      <EmptyState
        title="Not available"
        description="WelcomeHome mapping requires an administrator or marketing role in this organization."
      />
    );
  }

  const mappedByCommunity = new Map<string, any>(
    (mappings.data ?? []).map((m: any) => [m.community_id, m]),
  );
  const externalUse = new Map<string, number>();
  for (const m of mappings.data ?? []) {
    const key = String((m as any).external_id);
    externalUse.set(key, (externalUse.get(key) ?? 0) + 1);
  }

  const s = settings.data;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin"
        title="WelcomeHome Mapping"
        description="Every WelcomeHome record resolves through these canonical mappings. Unmapped communities are never ingested, so they cannot contaminate a mapped community's numbers."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Community mapping</h2>
        <DataTable
          columns={[
            { key: "clarity", header: "ClarityIQ community", render: (c: any) => c.name },
            {
              key: "wh",
              header: "WelcomeHome community",
              render: (c: any) => {
                const current = mappedByCommunity.get(c.id);
                return (
                  <Select
                    value={current ? String(current.external_id) : "__none"}
                    onValueChange={(v) => {
                      const chosen = (discovered.data ?? []).find((d: any) => d.source_id === v);
                      setCommunityMapping.mutate({
                        communityId: c.id,
                        externalId: v === "__none" ? null : v,
                        name: (chosen as any)?.name ?? null,
                      });
                    }}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Not mapped</SelectItem>
                      {(discovered.data ?? []).map((d: any) => (
                        <SelectItem key={d.source_id} value={d.source_id}>
                          {d.name ?? d.source_id} ({d.source_id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              },
            },
            {
              key: "source",
              header: "Source ID",
              render: (c: any) => {
                const current = mappedByCommunity.get(c.id);
                return current ? <code className="text-xs">{current.external_id}</code> : "—";
              },
            },
            {
              key: "state",
              header: "State",
              render: (c: any) => {
                const current = mappedByCommunity.get(c.id);
                if (!current) return <span className="text-xs text-warning">Unmapped</span>;
                const dup = (externalUse.get(String(current.external_id)) ?? 0) > 1;
                return dup ? (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3" /> Duplicate source ID
                  </span>
                ) : (
                  <span className="text-xs text-success">Mapped</span>
                );
              },
            },
          ]}
          rows={(communities.data ?? []) as any[]}
          loading={communities.isLoading}
          empty={<EmptyState title="No communities" description="Create communities first." />}
        />
        {(discovered.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No WelcomeHome communities discovered yet — run discovery on the connection screen.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Activity type → semantic category</h2>
          <p className="text-xs text-muted-foreground">
            Tour and Re-Tour counts come only from types mapped here. No numeric WelcomeHome ID is
            hard-coded and no category is guessed from text.
          </p>
        </div>
        <DataTable
          columns={[
            { key: "label", header: "WelcomeHome activity type", render: (r: any) => r.activity_type_label ?? r.activity_type_id },
            { key: "id", header: "Source ID", render: (r: any) => <code className="text-xs">{r.activity_type_id}</code> },
            {
              key: "cat",
              header: "ClarityIQ category",
              render: (r: any) => (
                <Select
                  value={r.category}
                  onValueChange={(v) => setActivityCategory.mutate({ id: r.id, category: v as (typeof WH_ACTIVITY_CATEGORIES)[number] })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WH_ACTIVITY_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {WH_ACTIVITY_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ]}
          rows={(activityMappings.data ?? []) as any[]}
          loading={activityMappings.isLoading}
          empty={
            <EmptyState
              title="No activity types loaded"
              description="Run a sync to load the ActivityTypes lookup from WelcomeHome."
            />
          }
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Score → semantic level</h2>
          <p className="text-xs text-muted-foreground">
            Hot lead metrics stay unresolved until at least one WelcomeHome score is mapped to Hot.
          </p>
        </div>
        <DataTable
          columns={[
            { key: "label", header: "WelcomeHome score", render: (r: any) => r.score_label ?? r.score_id },
            { key: "id", header: "Source ID", render: (r: any) => <code className="text-xs">{r.score_id}</code> },
            {
              key: "level",
              header: "ClarityIQ level",
              render: (r: any) => (
                <Select value={r.level} onValueChange={(v) => setScoreLevel.mutate({ id: r.id, level: v as (typeof WH_SCORE_LEVELS)[number] })}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WH_SCORE_LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {WH_SCORE_LEVEL_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ]}
          rows={(scoreMappings.data ?? []) as any[]}
          loading={scoreMappings.isLoading}
          empty={
            <EmptyState
              title="No scores loaded"
              description="Run a sync to load the Scores lookup from WelcomeHome."
            />
          }
        />
      </section>

      {s ? (
        <section className="panel space-y-5 p-5">
          <div>
            <h2 className="text-sm font-semibold">Provisional metric configuration</h2>
            <p className="text-xs text-muted-foreground">
              These choices are recorded and displayed alongside every provisional KPI. They are not
              approvals — validation happens in the Reconciliation workspace.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Inquiry date field (V-001)</Label>
              <Select
                value={s.inquiry_date_field}
                onValueChange={(v) => saveSettings.mutate({ inquiry_date_field: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INQUIRY_DATE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Move-in date field (V-004)</Label>
              <Select
                value={s.move_in_date_field}
                onValueChange={(v) => saveSettings.mutate({ move_in_date_field: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOVE_IN_DATE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Move-out date field (V-004)</Label>
              <Select
                value={s.move_out_date_field}
                onValueChange={(v) => saveSettings.mutate({ move_out_date_field: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOVE_OUT_DATE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Deposit source (V-003)</Label>
              <Select
                value={s.deposit_source}
                onValueChange={(v) => saveSettings.mutate({ deposit_source: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit_transactions">DepositTransactions</SelectItem>
                  <SelectItem value="housing_contracts">HousingContract deposit fields</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Hot lead attention policy</Label>
              <Select
                value={s.hot_no_activity_mode}
                onValueChange={(v) => saveSettings.mutate({ hot_no_activity_mode: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none_scheduled">No future activity scheduled</SelectItem>
                  <SelectItem value="none_or_overdue">No future activity or overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stalled">Stalled threshold (days)</Label>
              <Input
                id="stalled"
                type="number"
                min={1}
                defaultValue={s.stalled_threshold_days}
                onBlur={(e) =>
                  saveSettings.mutate({ stalled_threshold_days: Number(e.target.value) || 14 })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="overlap">Incremental overlap (minutes)</Label>
              <Input
                id="overlap"
                type="number"
                min={0}
                defaultValue={s.incremental_overlap_minutes}
                onBlur={(e) =>
                  saveSettings.mutate({ incremental_overlap_minutes: Number(e.target.value) || 0 })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Each incremental request asks for updated_at_after = last observed source max minus
                this overlap. Source-ID upsert makes the re-read harmless.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Daily Snapshots</Label>
              <p className="text-sm capitalize text-muted-foreground">
                {s.daily_snapshots_state.replace(/_/g, " ")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Optional in Phase 2. Historical &ldquo;as of&rdquo; reporting is not built yet.
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => invalidate()}>
            Refresh
          </Button>
        </section>
      ) : null}
    </div>
  );
}
