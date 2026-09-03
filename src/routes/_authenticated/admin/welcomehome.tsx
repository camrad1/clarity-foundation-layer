import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { KeyRound, PlugZap, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/lib/clarity-queries";
import {
  whCheckDailySnapshots,
  whCredentialStatus,
  whDiscoverCommunities,
  whFinalizeSync,
  whPlanSync,
  whRunSyncUnit,
  whSaveCredential,
  whSeedMappingRows,
  whTestConnection,
  type WhWorkUnit,
} from "@/lib/wh/welcomehome.functions";
import {
  useWhCommunityMappings,
  useWhConnection,
  useWhSourceCommunities,
  useWhSyncState,
  useWhSyncRuns,
  useWhTableRuns,
} from "@/lib/wh/queries";
import {
  CommunitySyncOverview,
  RecentSyncRuns,
  SyncRunSummary,
  summarizeRun,
  type RunSummary,
} from "@/components/clarity/wh-sync-runs";
import { WH_ALL_TABLES, WH_CORE_TABLES } from "@/lib/wh/tables";
import { whNightlyCancel, whNightlyRunNow, whNightlyTick } from "@/lib/wh/nightly.functions";
import { useNightlyRuns } from "@/lib/wh/snapshots";
import { useAppState } from "@/state/app-state";


export const Route = createFileRoute("/_authenticated/admin/welcomehome")({
  head: () => ({
    meta: [
      { title: "WelcomeHome Connection — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Securely connect ClarityIQ to WelcomeHome CRM, discover communities and run read-only synchronization.",
      },
      { property: "og:title", content: "WelcomeHome Connection — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Server-side WelcomeHome credential storage, connection tests and sync monitoring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WelcomeHomeAdmin,
});

function fmt(d: string | null | undefined) {
  return d ? format(new Date(d), "MMM d, yyyy h:mm a") : "Never";
}

function WelcomeHomeAdmin() {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const connection = useWhConnection(organizationId);
  const connectionId = connection.data?.id ?? null;
  const sourceCommunities = useWhSourceCommunities(connectionId);
  const syncState = useWhSyncState(connectionId);
  const runs = useWhTableRuns(connectionId, 40);
  const syncRuns = useWhSyncRuns(connectionId, 8);
  const [token, setToken] = useState("");
  const mappings = useWhCommunityMappings(organizationId);
  const { communityScope } = useAppState();


  const save = useServerFn(whSaveCredential);
  const test = useServerFn(whTestConnection);
  const discover = useServerFn(whDiscoverCommunities);
  const planSync = useServerFn(whPlanSync);
  const runUnit = useServerFn(whRunSyncUnit);
  const finalize = useServerFn(whFinalizeSync);
  const snapshots = useServerFn(whCheckDailySnapshots);
  const seed = useServerFn(whSeedMappingRows);


  const credential = useQuery({
    queryKey: ["wh_credential_status", connectionId],
    enabled: !!connectionId,
    queryFn: () => whCredentialStatus({ data: { connectionId: connectionId! } }),
  });

  const createConnection = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("No organization selected");
      const { error } = await supabase.from("data_source_connections").insert({
        organization_id: organizationId,
        source_type: "welcomehome",
        display_name: "WelcomeHome CRM",
        status: "disconnected",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WelcomeHome connection created");
      qc.invalidateQueries({ queryKey: ["wh_connection"] });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveToken = useMutation({
    mutationFn: async () => save({ data: { connectionId: connectionId!, token } }),
    onSuccess: () => {
      setToken("");
      toast.success("Token stored server-side. It is never returned to the browser.");
      credential.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runTest = useMutation({
    mutationFn: async () => test({ data: { connectionId: connectionId! } }),
    onSuccess: (r) => {
      r.ok ? toast.success(r.message) : toast.error(r.message);
      credential.refetch();
      qc.invalidateQueries({ queryKey: ["wh_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runDiscover = useMutation({
    mutationFn: async () => discover({ data: { connectionId: connectionId! } }),
    onSuccess: (r) => {
      r.ok
        ? toast.success(`${r.count} WelcomeHome communities discovered`)
        : toast.error(r.message ?? "Discovery failed");
      sourceCommunities.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runSnapshots = useMutation({
    mutationFn: async () => snapshots({ data: { connectionId: connectionId! } }),
    onSuccess: (r) => {
      toast.success(`Daily Snapshots: ${r.state.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["wh_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------
  // Sync orchestration
  // ---------------------------------------------------------------------
  // A sync is a sequence of bounded work units (one dataset x one community),
  // each its own short request. Nothing about this loop grows with portfolio
  // size except the number of units, so adding communities never turns one
  // request into a timeout.
  const [scope, setScope] = useState<"selected" | "all">("selected");
  // "" = every supported table; otherwise exactly one dataset.
  const [tableScope, setTableScope] = useState<string>("");
  const [progress, setProgress] = useState<{
    total: number;
    done: number;
    failed: number;
    current: string | null;
    runId: string | null;
    running: boolean;
    failedUnits: WhWorkUnit[];
  }>({ total: 0, done: 0, failed: 0, current: null, runId: null, running: false, failedUnits: [] });
  const cancelRef = useRef(false);

  const mappedList = useMemo(
    () =>
      (mappings.data ?? []).filter((m: any) => m.active).map((m: any) => ({
        communityId: m.community_id as string,
        name: (m.communities?.name as string) ?? "Community",
      })),
    [mappings.data],
  );

  const nameOf = useMemo(() => {
    const map = new Map(mappedList.map((m) => [m.communityId, m.name] as const));
    return (id: string) => map.get(id) ?? "Community";
  }, [mappedList]);

  const runSummaries = useMemo(
    () => (syncRuns.data ?? []).map((r) => summarizeRun(r, nameOf)),
    [syncRuns.data, nameOf],
  );
  const latestSummary = runSummaries[0] ?? null;

  const [banner, setBanner] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);

  const scopedCommunityIds = useMemo(() => {
    if (scope === "all") return undefined;
    if (communityScope.mode !== "communities") return undefined;
    return communityScope.communityIds;
  }, [scope, communityScope]);

  const scopeLabel = !scopedCommunityIds
    ? `all ${mappedList.length} mapped communities`
    : `${scopedCommunityIds.length} selected communit${scopedCommunityIds.length === 1 ? "y" : "ies"}`;

  async function orchestrate(opts: {
    mode: "full" | "incremental";
    resumeRunId?: string;
    onlyUnits?: WhWorkUnit[];
  }) {
    if (!connectionId) return;
    cancelRef.current = false;
    setProgress((p) => ({ ...p, running: true, failed: 0, done: 0, failedUnits: [], current: "Planning…" }));
    try {
      const plan = await planSync({
        data: {
          connectionId,
          mode: opts.mode,
          ...(scopedCommunityIds ? { communityIds: scopedCommunityIds } : {}),
          ...(tableScope ? { tables: [tableScope] } : {}),
          ...(opts.resumeRunId ? { resumeRunId: opts.resumeRunId } : {}),
        },
      });
      if (!plan.ok || !plan.syncRunId) {
        setProgress((p) => ({ ...p, running: false, current: null }));
        toast.error(plan.message ?? "Nothing to sync");
        return;
      }
      let units = plan.units;
      if (opts.onlyUnits?.length) {
        const keys = new Set(opts.onlyUnits.map((u) => u.key));
        units = units.filter((u) => keys.has(u.key));
      }
      const runId = plan.syncRunId;
      setProgress({
        total: units.length,
        done: 0,
        failed: 0,
        current: null,
        runId,
        running: true,
        failedUnits: [],
      });

      const failedUnits: WhWorkUnit[] = [];
      for (const unit of units) {
        if (cancelRef.current) break;
        setProgress((p) => ({
          ...p,
          current: `${unit.table}${unit.communityName ? ` — ${unit.communityName}` : " (account-wide)"}`,
        }));
        try {
          const res = await runUnit({
            data: {
              connectionId,
              syncRunId: runId,
              mode: opts.mode,
              table: unit.table,
              communityId: unit.communityId,
            },
          });
          if (res.status === "failed" || res.status === "partial") failedUnits.push(unit);
        } catch {
          // One failing dataset never aborts the portfolio: the unit is
          // recorded, retryable, and the run continues.
          failedUnits.push(unit);
        }
        qc.invalidateQueries({ queryKey: ["wh_sync_runs"] });
        setProgress((p) => ({
          ...p,
          done: p.done + 1,
          failed: failedUnits.length,
          failedUnits: [...failedUnits],
        }));
      }

      const summary = await finalize({
        data: {
          connectionId,
          syncRunId: runId,
          expectedUnits: units.length + plan.skipped.length,
          ...(cancelRef.current ? { canceled: true } : {}),
        },
      });
      await seed({ data: { connectionId } });

      const attempted = units.length;
      const succeeded = attempted - failedUnits.length;
      if (cancelRef.current) {
        toast.warning("Sync canceled. Completed work is saved and resumable.");
        setBanner({ tone: "warn", text: `Sync canceled — ${succeeded} of ${attempted} work units succeeded.` });
      } else if (summary.status === "success") {
        toast.success("Sync completed");
        setBanner({ tone: "ok", text: `Sync complete — ${succeeded} of ${attempted} work units succeeded.` });
      } else if (summary.status === "partial") {
        toast.warning(`Sync partially completed — ${failedUnits.length} unit(s) need a retry.`);
        setBanner({
          tone: "warn",
          text: `Sync finished with issues — ${succeeded} of ${attempted} succeeded. ${failedUnits.length} work unit${failedUnits.length === 1 ? "" : "s"} require attention.`,
        });
      } else {
        toast.error("Sync failed. Review the table runs below.");
        setBanner({ tone: "bad", text: `Sync failed — ${succeeded} of ${attempted} work units succeeded.` });
      }
      window.setTimeout(() => setBanner(null), 20000);

      setProgress((p) => ({ ...p, running: false, current: null }));
      syncState.refetch();
      runs.refetch();
      syncRuns.refetch();
      qc.invalidateQueries({ queryKey: ["wh_lookups"] });
      qc.invalidateQueries({ queryKey: ["wh_activity_mappings"] });
      qc.invalidateQueries({ queryKey: ["wh_score_mappings"] });
      qc.invalidateQueries({ queryKey: ["wh_connection"] });
    } catch (e) {
      setProgress((p) => ({ ...p, running: false, current: null }));
      toast.error((e as Error).message);
    }
  }


  function retryFailed(summary: RunSummary) {
    // Resume the same parent run: the planner skips units that already
    // succeeded, so only failed or never-completed work is re-attempted.
    const only: WhWorkUnit[] = summary.failedUnits.map((u) => ({
      key: `${u.table}:${u.communityId ?? "*"}`,
      table: u.table,
      communityId: u.communityId,
      communityName: u.communityName,
      scope: u.communityId ? ("community" as const) : ("account" as const),
    }));
    void orchestrate({
      mode: "full",
      resumeRunId: summary.id,
      ...(only.length ? { onlyUnits: only } : {}),
    });
  }

  if (!canManageImports) {
    return (
      <EmptyState
        title="Not available"
        description="Managing the WelcomeHome connection requires an administrator or marketing role in this organization."
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="WelcomeHome Connection"
        description="WelcomeHome remains the system of record. ClarityIQ reads it and stores analytics copies — no record, activity, stage or note is ever written back."
      />

      {!connection.data ? (
        <EmptyState
          title="No WelcomeHome connection"
          description="Create the connection to begin storing a token, discovering communities and synchronizing analytics copies."
          icon={<PlugZap className="size-6" />}
          action={
            <Button onClick={() => createConnection.mutate()} disabled={createConnection.isPending}>
              Create WelcomeHome connection
            </Button>
          }
        />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="panel space-y-1 p-5">
              <p className="eyebrow">Connection</p>
              <StatusPill status={connection.data.status} />
              <p className="pt-2 text-xs text-muted-foreground">
                Last attempt {fmt(connection.data.last_attempted_sync_at)}
              </p>
              <p className="text-xs text-muted-foreground">
                Last success {fmt(connection.data.last_successful_sync_at)}
              </p>
            </div>
            <div className="panel space-y-1 p-5">
              <p className="eyebrow">Credential</p>
              <StatusPill status={credential.data?.configured ? "connected" : "disconnected"} />
              <p className="pt-2 text-xs text-muted-foreground">
                {credential.data?.configured
                  ? `Stored ${fmt(credential.data.rotatedAt)} — value is write-only`
                  : "No API token configured"}
              </p>
              {credential.data?.lastError ? (
                <p className="text-xs text-destructive">{credential.data.lastError}</p>
              ) : null}
            </div>
            <div className="panel space-y-1 p-5">
              <p className="eyebrow">Data through</p>
              <p className="font-display text-lg font-semibold">
                {connection.data.data_through_date ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Maximum source updated_at observed across synchronized tables.
              </p>
            </div>
          </section>

          {banner ? (
            <div
              className={
                banner.tone === "ok"
                  ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
                  : banner.tone === "warn"
                    ? "rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
                    : "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              }
            >
              {banner.text}
            </div>
          ) : null}

          <SyncRunSummary
            summary={latestSummary}
            onRetryFailed={retryFailed}
            busy={progress.running}
          />

          <CommunitySyncOverview
            syncState={(syncState.data ?? []) as any[]}
            nameOf={nameOf}
            communityIds={mappedList.map((m) => m.communityId)}
            loading={syncState.isLoading}
          />

          <RecentSyncRuns
            summaries={runSummaries}
            loading={syncRuns.isLoading}
            onRetryFailed={retryFailed}
            busy={progress.running}
          />

          <section className="panel space-y-4 p-5">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">API token</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              The token is sent directly to the server, stored in a table no signed-in user can read,
              and used only to add the <code>Authorization: Token token=…</code> header on
              server-side requests. It is never returned to the browser or written to logs.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor="wh-token">
                  {credential.data?.configured ? "Replace token" : "WelcomeHome API token"}
                </Label>
                <Input
                  id="wh-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste token"
                />
              </div>
              <Button
                onClick={() => saveToken.mutate()}
                disabled={token.trim().length < 8 || saveToken.isPending}
              >
                Save token
              </Button>
              <Button
                variant="outline"
                onClick={() => runTest.mutate()}
                disabled={!credential.data?.configured || runTest.isPending}
              >
                Test connection
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Last verified {fmt(credential.data?.lastVerifiedAt)}
            </p>
          </section>

          <NightlyPanel
            organizationId={organizationId}
            connectionId={connectionId}
            canManage={!!canManageImports && !!credential.data?.configured}
          />


          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Community discovery</h2>
                <p className="text-xs text-muted-foreground">
                  {sourceCommunities.data?.length ?? 0} WelcomeHome communities discovered. Map them
                  on the WelcomeHome Mapping screen before syncing.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runDiscover.mutate()}
                disabled={!credential.data?.configured || runDiscover.isPending}
              >
                <Search className="size-4" /> Discover communities
              </Button>
            </div>
            <DataTable
              columns={[
                { key: "id", header: "Source ID", render: (r: any) => <code className="text-xs">{r.source_id}</code> },
                { key: "name", header: "Name", render: (r: any) => r.name ?? "—" },
                {
                  key: "discovered",
                  header: "Discovered",
                  render: (r: any) => (
                    <span className="text-xs text-muted-foreground">{fmt(r.discovered_at)}</span>
                  ),
                },
              ]}
              rows={(sourceCommunities.data ?? []) as any[]}
              loading={sourceCommunities.isLoading}
              empty={
                <EmptyState
                  title="No communities discovered yet"
                  description="Run discovery after saving a valid token."
                />
              }
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Synchronization</h2>
                <p className="text-xs text-muted-foreground">
                  Sync runs as bounded work units — one dataset for one community per request — so
                  duration does not grow with portfolio size. Progress is saved continuously and any
                  interrupted run can be resumed. Incremental sync uses each table's own watermark with a
                  safety overlap, and source-ID upsert keeps it idempotent.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSnapshots.mutate()}
                  disabled={!credential.data?.configured || runSnapshots.isPending}
                >
                  Check Daily Snapshots
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => orchestrate({ mode: "incremental" })}
                  disabled={!credential.data?.configured || progress.running}
                >
                  <RefreshCw className="size-4" /> Incremental sync
                </Button>
                <Button
                  size="sm"
                  onClick={() => orchestrate({ mode: "full" })}
                  disabled={!credential.data?.configured || progress.running}
                >
                  Full sync
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-4">
                <Label className="text-xs font-medium">Sync scope</Label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={scope === "selected"}
                    onCheckedChange={(v) => setScope(v ? "selected" : "all")}
                  />
                  Use the dashboard community filter
                </label>
                <span className="text-xs text-muted-foreground">
                  This sync will cover <span className="font-medium text-foreground">{scopeLabel}</span>.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Label className="text-xs font-medium" htmlFor="wh-table-scope">
                  Tables
                </Label>
                <select
                  id="wh-table-scope"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={tableScope}
                  onChange={(e) => setTableScope(e.target.value)}
                  disabled={progress.running}
                >
                  <option value="">All supported tables</option>
                  {WH_ALL_TABLES.map((t) => (
                    <option key={t} value={t}>
                      {t} only
                    </option>
                  ))}
                </select>
                {tableScope ? (
                  <span className="text-xs text-muted-foreground">
                    Only <span className="font-medium text-foreground">{tableScope}</span> will be
                    synced for the scope above.
                  </span>
                ) : null}
              </div>

              {progress.total > 0 || progress.running ? (
                <div className="space-y-1 text-xs">
                  <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                    <span>
                      {progress.done} / {progress.total} work units
                      {progress.failed ? ` · ${progress.failed} need retry` : ""}
                    </span>
                    {progress.current ? <span>Running: {progress.current}</span> : null}
                    {progress.running ? (
                      <Button size="sm" variant="ghost" onClick={() => (cancelRef.current = true)}>
                        Cancel
                      </Button>
                    ) : null}
                    {!progress.running && progress.runId ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => orchestrate({ mode: "full", resumeRunId: progress.runId! })}
                        >
                          Resume run
                        </Button>
                        {progress.failedUnits.length ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              orchestrate({
                                mode: "full",
                                resumeRunId: progress.runId!,
                                onlyUnits: progress.failedUnits,
                              })
                            }
                          >
                            Retry failed
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>


            <DataTable
              columns={[
                {
                  key: "table",
                  header: "Table",
                  render: (r: any) => (
                    <span className="font-medium">
                      {r.source_table}
                      {(WH_CORE_TABLES as readonly string[]).includes(r.source_table) ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">core</span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "State",
                  render: (r: any) =>
                    r.error_summary ? (
                      <StatusPill status="failed" />
                    ) : r.last_successful_at ? (
                      <StatusPill status="success" />
                    ) : (
                      <StatusPill status="pending" />
                    ),
                },
                { key: "last", header: "Last success", render: (r: any) => <span className="text-xs">{fmt(r.last_successful_at)}</span> },
                { key: "wm", header: "Watermark", render: (r: any) => <span className="text-xs">{fmt(r.watermark)}</span> },
                { key: "recv", header: "Received", align: "right", render: (r: any) => r.rows_received },
                { key: "ins", header: "Inserted", align: "right", render: (r: any) => r.rows_inserted },
                { key: "upd", header: "Updated", align: "right", render: (r: any) => r.rows_updated },
                { key: "fail", header: "Failed", align: "right", render: (r: any) => r.rows_failed },
                {
                  key: "err",
                  header: "Error",
                  render: (r: any) => (
                    <span className="text-xs text-destructive">{r.error_summary ?? "—"}</span>
                  ),
                },
              ]}
              rows={(syncState.data ?? []) as any[]}
              loading={syncState.isLoading}
              empty={
                <EmptyState
                  title="No synchronization yet"
                  description="Map at least one community, then run a full sync."
                />
              }
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Recent table runs (detail)</h2>
            <DataTable
              columns={[
                { key: "started", header: "Started", render: (r: any) => <span className="text-xs">{fmt(r.started_at)}</span> },
                { key: "table", header: "Table", render: (r: any) => r.source_table },
                { key: "mode", header: "Mode", render: (r: any) => r.mode },
                { key: "status", header: "Status", render: (r: any) => <StatusPill status={r.status} /> },
                { key: "recv", header: "Received", align: "right", render: (r: any) => r.rows_received },
                { key: "raw", header: "Raw kept", align: "right", render: (r: any) => r.raw_rows_stored },
                { key: "pages", header: "Pages", align: "right", render: (r: any) => r.pages_fetched },
                {
                  key: "err",
                  header: "Detail",
                  render: (r: any) => (
                    <span className="text-xs text-muted-foreground">
                      {r.error_summary ?? (r.warnings?.length ? r.warnings.join("; ") : "—")}
                    </span>
                  ),
                },
              ]}
              rows={(runs.data ?? []) as any[]}
              loading={runs.isLoading}
              empty={<EmptyState title="No runs recorded" />}
            />
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Nightly refresh + immutable daily snapshot.
 *
 * The schedule runs this automatically; this panel is the manual equivalent
 * and uses exactly the same bounded worker. Each click processes a small slice
 * of communities, so nothing here is a long-running request.
 */
function NightlyPanel({
  organizationId,
  connectionId,
  canManage,
}: {
  organizationId: string | null;
  connectionId: string | null;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const runNow = useServerFn(whNightlyRunNow);
  const tick = useServerFn(whNightlyTick);
  const cancel = useServerFn(whNightlyCancel);
  const runs = useNightlyRuns(organizationId, 5);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const active = (runs.data ?? []).find((r) => r.status === "queued" || r.status === "running") ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wh_nightly_runs"] });
    qc.invalidateQueries({ queryKey: ["wh_snapshot_health"] });
  };

  async function drive() {
    if (!connectionId) return;
    setBusy(true);
    setLog([]);
    try {
      const first = await runNow({ data: { connectionId, maxCommunities: 2 } });
      if (!first.ok || !first.runId) {
        toast.error(first.message ?? "Nothing to run");
        return;
      }
      let runId = first.runId;
      let result = first.tick;
      let guard = 0;
      // Bounded loop: each hop is one small slice, and it stops as soon as the
      // run reports no remaining communities.
      while (result && result.remaining > 0 && guard < 200) {
        guard += 1;
        setLog((l) => [
          ...l,
          ...result!.details.map((d) => `${d.community}: ${d.status}${d.error ? ` — ${d.error}` : ""}`),
        ]);
        refresh();
        result = await tick({ data: { connectionId, runId, maxCommunities: 2 } });
      }
      if (result) {
        setLog((l) => [
          ...l,
          ...result!.details.map((d) => `${d.community}: ${d.status}${d.error ? ` — ${d.error}` : ""}`),
          `Run ${result!.status} · ${result!.snapshots} snapshot(s) written`,
        ]);
      }
      toast.success("Nightly refresh finished");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nightly run failed");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Nightly refresh &amp; daily snapshot</h2>
          <p className="text-xs text-muted-foreground">
            Refreshes Units and Housing Contracts for every mapped community, then writes one immutable
            snapshot per community for its local calendar date. A snapshot is skipped — with a recorded
            reason — when the refresh does not complete cleanly, and existing snapshots are never rewritten.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={drive} disabled={!canManage || busy || !connectionId}>
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} /> Run now
          </Button>
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!connectionId) return;
                await cancel({ data: { connectionId, runId: active.id } });
                refresh();
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        rows={runs.data ?? []}
        empty={<p className="p-6 text-sm text-muted-foreground">No nightly runs yet.</p>}
        columns={[
          { key: "d", header: "Run date", render: (r: any) => r.run_date },
          { key: "s", header: "Status", render: (r: any) => <StatusPill status={r.status} /> },
          { key: "t", header: "Trigger", render: (r: any) => r.triggered_by },
          {
            key: "p",
            header: "Communities",
            align: "right",
            render: (r: any) =>
              `${r.communities_done}/${r.communities_total}${r.communities_failed ? ` · ${r.communities_failed} failed` : ""}`,
          },
          { key: "n", header: "Snapshots", align: "right", render: (r: any) => r.snapshots_written },
          { key: "f", header: "Finished", render: (r: any) => fmt(r.finished_at) },
        ]}
      />

      {log.length ? (
        <pre className="panel max-h-48 overflow-auto p-3 text-[11px] text-muted-foreground">
          {log.join("\n")}
        </pre>
      ) : null}
    </section>
  );
}
