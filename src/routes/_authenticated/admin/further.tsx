import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { KeyRound, Link2, PlugZap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
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
import { useCommunities, useOrgRole } from "@/lib/clarity-queries";
import {
  furtherConfirmMapping,
  furtherCredentialStatus,
  furtherDiscoverCommunities,
  furtherRetryFailed,
  furtherRunSync,
  furtherSaveCredential,
  furtherTestConnection,
  furtherValidateMatches,
} from "@/lib/further/further.functions";
import {
  useFurtherConnection,
  useFurtherCounts,
  useFurtherFreshness,
  useFurtherMatchSummary,
  useFurtherSourceCommunities,
  useFurtherSyncState,
  useFurtherUnitRuns,
} from "@/lib/further/queries";
import { FURTHER_DATASET_LABELS, type FurtherDataset } from "@/lib/further/tables";
import { useQuery } from "@tanstack/react-query";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/further")({
  head: () => ({
    meta: [
      { title: "Further Connection — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Connect Further securely, map Further communities and monitor read-only visitor, lead and conversation synchronization.",
      },
      { property: "og:title", content: "Further Connection — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Server-side Further API key storage, connection tests, sync health and WelcomeHome match validation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FurtherAdmin,
});

function fmt(d: string | null | undefined) {
  return d ? format(new Date(d), "MMM d, yyyy h:mm a") : "Never";
}

function FurtherAdmin() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const connection = useFurtherConnection(organizationId);
  const connectionId = connection.data?.id ?? null;
  const sourceCommunities = useFurtherSourceCommunities(connectionId);
  const communities = useCommunities(organizationId);
  const counts = useFurtherCounts(organizationId, connectionId);
  const freshness = useFurtherFreshness(organizationId);
  const syncState = useFurtherSyncState(connectionId);
  const unitRuns = useFurtherUnitRuns(connectionId, 40);
  const matchSummary = useFurtherMatchSummary(organizationId);
  const [apiKey, setApiKey] = useState("");

  const save = useServerFn(furtherSaveCredential);
  const test = useServerFn(furtherTestConnection);
  const discover = useServerFn(furtherDiscoverCommunities);
  const confirmMapping = useServerFn(furtherConfirmMapping);
  const runSync = useServerFn(furtherRunSync);
  const retryFailed = useServerFn(furtherRetryFailed);
  const validateMatches = useServerFn(furtherValidateMatches);

  const credential = useQuery({
    queryKey: ["further_credential", connectionId],
    enabled: !!connectionId,
    queryFn: () => furtherCredentialStatus({ data: { connectionId: connectionId! } }),
  });

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["further_credential", connectionId] }),
      qc.invalidateQueries({ queryKey: ["further_connection", organizationId] }),
      qc.invalidateQueries({ queryKey: ["further_source_communities", connectionId] }),
      qc.invalidateQueries({ queryKey: ["further_counts", organizationId, connectionId] }),
      qc.invalidateQueries({ queryKey: ["further_freshness", organizationId] }),
      qc.invalidateQueries({ queryKey: ["further_sync_state", connectionId] }),
      qc.invalidateQueries({ queryKey: ["further_unit_runs", connectionId, 40] }),
      qc.invalidateQueries({ queryKey: ["further_match_summary", organizationId] }),
    ]);
  };

  const saveKey = useMutation({
    mutationFn: async () => {
      if (!connectionId) throw new Error("Register a Further connection in Admin → Data Sources first.");
      return save({ data: { connectionId, key: apiKey.trim() } });
    },
    onSuccess: async () => {
      setApiKey("");
      toast.success("Organization API Key saved server-side. Run Test connection to verify it.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const testConn = useMutation({
    mutationFn: async () => test({ data: { connectionId: connectionId! } }),
    onSuccess: async (r) => {
      if (r.ok) toast.success(`Connected to Further — ${r.communities} accessible communities.`);
      else toast.error(r.message ?? "Further did not accept the key.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const discoverComms = useMutation({
    mutationFn: async () => discover({ data: { connectionId: connectionId! } }),
    onSuccess: async (r) => {
      if (r.ok) toast.success(`${r.count} Further communities retrieved.`);
      else toast.error(r.message ?? "Community discovery failed.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const sync = useMutation({
    mutationFn: async (vars: { scope: "hourly" | "nightly" | "all"; mode: "full" | "incremental" }) =>
      runSync({ data: { connectionId: connectionId!, scope: vars.scope, mode: vars.mode } }),
    onSuccess: async (r) => {
      const summary = r.units
        .map((u) => `${FURTHER_DATASET_LABELS[u.dataset as FurtherDataset]} ${u.received}`)
        .join(", ");
      if (r.status === "success") toast.success(`Sync complete — ${summary || "no new records"}.`);
      else if (r.status === "partial")
        toast.warning(`Sync partially complete — ${summary}. ${r.message ?? ""}`);
      else if (r.status === "skipped") toast.warning(r.message ?? "Nothing to sync yet.");
      else toast.error(r.message ?? "Sync failed.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const retry = useMutation({
    mutationFn: async () => retryFailed({ data: { connectionId: connectionId! } }),
    onSuccess: async (r) => {
      if (r.status === "skipped") toast.info(r.message ?? "No failed work to retry.");
      else if (r.ok) toast.success(`Retried ${r.datasets.length} work unit(s).`);
      else toast.error(r.message ?? "Retry failed.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const validate = useMutation({
    mutationFn: async () => validateMatches({ data: { connectionId: connectionId! } }),
    onSuccess: async (r) => {
      if (!r.ok || !r.report) toast.error(r.message ?? "Match validation failed.");
      else if (r.report.activeMatches)
        toast.success(
          `${r.report.activeMatches.toLocaleString()} active exact-ID matches · ${r.report.conflicts.toLocaleString()} conflicts · ${r.report.needsReview.toLocaleString()} need review · ${r.report.unmatched.toLocaleString()} unmatched.`,
        );
      else toast.warning(r.report.note);

      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const mapMutation = useMutation({
    mutationFn: async (vars: {
      furtherCommunityId: string;
      furtherCommunityName: string | null;
      communityId: string | null;
    }) => confirmMapping({ data: { connectionId: connectionId!, ...vars } }),
    onSuccess: async () => {
      toast.success("Mapping confirmed.");
      await refreshAll();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const latestByDataset = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of (unitRuns.data ?? []) as any[]) if (!map.has(r.dataset)) map.set(r.dataset, r);
    return map;
  }, [unitRuns.data]);

  const c = counts.data;
  const canManage = canManageImports && !!connectionId;

  if (!connection.isLoading && !connectionId) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Admin" title="Further Connection" />
        <EmptyState
          icon={<PlugZap className="size-6" />}
          title="No Further connection registered"
          description="Register a connection with source type Further in Admin → Data Sources, then return here to store the Organization API Key."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Further Connection"
        description="Read-only analytics integration with the Further Public API. The Organization API Key is stored server-side only, is never sent to the browser and is never logged. ClarityIQ never writes to Further."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canManage || testConn.isPending}
              onClick={() => testConn.mutate()}
            >
              <PlugZap className="mr-2 size-4" /> Test connection
            </Button>
            <Button
              disabled={!canManage || sync.isPending}
              onClick={() => sync.mutate({ scope: "hourly", mode: "incremental" })}
            >
              <RefreshCw className="mr-2 size-4" /> Sync now
            </Button>
            <Button variant="outline" disabled={!canManage || retry.isPending} onClick={() => retry.mutate()}>
              Retry failed work
            </Button>
          </div>
        }
      />

      {/* ---------------- Connection status ---------------- */}
      <section className="panel space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Status</p>
            <h2 className="text-base font-semibold text-foreground">
              {connection.data?.display_name ?? "Further"}
            </h2>
            <p className="text-xs text-muted-foreground">api.talkfurther.com · read-only</p>
          </div>
          <StatusPill status={connection.data?.status ?? "pending"} />
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Organization API Key</dt>
            <dd className="text-foreground">
              {credential.data?.configured ? (credential.data.masked ?? "Configured") : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last successful sync</dt>
            <dd className="text-foreground">{fmt(connection.data?.last_successful_sync_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last attempted sync</dt>
            <dd className="text-foreground">{fmt(connection.data?.last_attempted_sync_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last verified</dt>
            <dd className="text-foreground">{fmt(credential.data?.lastVerifiedAt)}</dd>
          </div>
        </dl>

        {credential.data?.lastError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {credential.data.lastError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="further-key">
              {credential.data?.configured ? "Replace Organization API Key" : "Organization API Key"}
            </Label>
            <Input
              id="further-key"
              type="password"
              autoComplete="off"
              placeholder="Paste the Further Organization API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={!canManageImports}
            />
            <p className="text-xs text-muted-foreground">
              Sent straight to secure server-side storage. Only a masked hint is ever displayed again.
            </p>
          </div>
          <Button
            disabled={!canManageImports || apiKey.trim().length < 8 || saveKey.isPending}
            onClick={() => saveKey.mutate()}
          >
            <KeyRound className="mr-2 size-4" />
            {credential.data?.configured ? "Update key" : "Save key"}
          </Button>
        </div>
      </section>

      {/* ---------------- Volume + freshness ---------------- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Communities mapped", value: c ? `${c.mappedCommunities} / ${c.discoveredCommunities}` : "—" },
          { label: "Leads synced", value: c ? c.leads.toLocaleString() : "—", sub: `Latest lead ${fmt(freshness.data?.leads)}` },
          { label: "Visitors synced", value: c ? c.visitors.toLocaleString() : "—", sub: `Latest visit ${fmt(freshness.data?.visitors)}` },
          {
            label: "Conversation events",
            value: c ? c.events.toLocaleString() : "—",
            sub: `Latest event ${fmt(freshness.data?.events)}`,
          },
        ].map((m) => (
          <article key={m.label} className="panel p-5">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{m.value}</p>
            {m.sub ? <p className="mt-1 text-xs text-muted-foreground">{m.sub}</p> : null}
          </article>
        ))}
      </section>

      {/* ---------------- Dataset sync state ---------------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Dataset sync state</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage || sync.isPending}
              onClick={() => sync.mutate({ scope: "nightly", mode: "incremental" })}
            >
              Run nightly datasets
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage || sync.isPending}
              onClick={() => sync.mutate({ scope: "all", mode: "full" })}
            >
              Full backfill slice
            </Button>
          </div>
        </div>
        <DataTable
          loading={syncState.isLoading}
          rows={(syncState.data ?? []) as any[]}
          empty={
            <EmptyState
              title="No sync has run yet"
              description="Save the API key, test the connection, discover communities, confirm mappings, then use Sync now."
            />
          }
          columns={[
            {
              key: "dataset",
              header: "Dataset",
              render: (r: any) => (
                <div>
                  <p className="font-medium">
                    {FURTHER_DATASET_LABELS[r.dataset as FurtherDataset] ?? r.dataset}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Watermark {r.watermark ? fmt(r.watermark) : "not set"}
                  </p>
                </div>
              ),
            },
            {
              key: "status",
              header: "Latest unit",
              render: (r: any) => {
                const latest = latestByDataset.get(r.dataset);
                return latest ? <StatusPill status={latest.status} /> : "—";
              },
            },
            { key: "last_success", header: "Last success", render: (r: any) => fmt(r.last_successful_at) },
            {
              key: "rows",
              header: "Rows (recv / ins / upd / fail)",
              align: "right",
              render: (r: any) =>
                `${r.rows_received} / ${r.rows_inserted} / ${r.rows_updated} / ${r.rows_failed}`,
            },
            {
              key: "unmapped",
              header: "Unmapped",
              align: "right",
              render: (r: any) => r.rows_unmapped,
            },
          ]}
        />
      </section>

      {/* ---------------- Community mapping ---------------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Further community mapping</h2>
            <p className="text-xs text-muted-foreground">
              Nothing is auto-mapped. Choose the canonical community for each Further community to
              activate its data.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || discoverComms.isPending}
            onClick={() => discoverComms.mutate()}
          >
            <Link2 className="mr-2 size-4" /> Discover communities
          </Button>
        </div>
        <DataTable
          loading={sourceCommunities.isLoading}
          rows={sourceCommunities.data ?? []}
          empty={
            <EmptyState
              title="No Further communities retrieved"
              description="Use Discover communities to read GET /api/v1/communities and list every community this key can access."
            />
          }
          columns={[
            {
              key: "name",
              header: "Further community",
              render: (r) => (
                <div>
                  <p className="font-medium">{r.name ?? "Unnamed"}</p>
                  <p className="text-xs text-muted-foreground">ID {r.further_community_id}</p>
                </div>
              ),
            },
            {
              key: "canonical",
              header: "ONELIFE community",
              render: (r) => (
                <Select
                  value={r.community_id ?? "unmapped"}
                  disabled={!canManage || mapMutation.isPending}
                  onValueChange={(v) =>
                    mapMutation.mutate({
                      furtherCommunityId: r.further_community_id,
                      furtherCommunityName: r.name,
                      communityId: v === "unmapped" ? null : v,
                    })
                  }
                >
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="Not mapped" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unmapped">Not mapped</SelectItem>
                    {(communities.data ?? []).map((cm: any) => (
                      <SelectItem key={cm.id} value={cm.id}>
                        {cm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
            {
              key: "status",
              header: "Mapping status",
              render: (r) => <StatusPill status={r.community_id ? "matched" : "unvalidated"} />,
            },
          ]}
        />
      </section>

      {/* ---------------- Further <-> WelcomeHome match validation ---------------- */}
      <section className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Further ↔ WelcomeHome match validation
            </h2>
            <p className="text-xs text-muted-foreground">
              Only deterministic identifier evidence is ever activated. Names, emails and phone
              numbers are never used for attribution.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || validate.isPending}
            onClick={() => validate.mutate()}
          >
            Validate join
          </Button>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Active matches</dt>
            <dd className="text-foreground">{matchSummary.data?.active ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Proven WelcomeHome field</dt>
            <dd className="text-foreground">{matchSummary.data?.field ?? "Not yet proven"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last validated</dt>
            <dd className="text-foreground">{fmt(matchSummary.data?.matchedAt)}</dd>
          </div>
        </dl>
      </section>

      {/* ---------------- Recent work units ---------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent work units</h2>
        <DataTable
          loading={unitRuns.isLoading}
          rows={(unitRuns.data ?? []) as any[]}
          empty={<EmptyState title="No work units yet" description="Run a sync to populate run history." />}
          columns={[
            {
              key: "dataset",
              header: "Dataset",
              render: (r: any) => FURTHER_DATASET_LABELS[r.dataset as FurtherDataset] ?? r.dataset,
            },
            { key: "status", header: "Status", render: (r: any) => <StatusPill status={r.status} /> },
            { key: "started", header: "Started", render: (r: any) => fmt(r.started_at) },
            {
              key: "rows",
              header: "Received",
              align: "right",
              render: (r: any) => r.rows_received,
            },
            {
              key: "pages",
              header: "Pages",
              align: "right",
              render: (r: any) => r.pages_fetched,
            },
            {
              key: "detail",
              header: "Detail",
              render: (r: any) => (
                <span className="text-xs text-muted-foreground">
                  {r.error_summary ?? (r.warnings?.length ? r.warnings[0] : "—")}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
