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
  useWhTableRuns,
} from "@/lib/wh/queries";
import { WH_CORE_TABLES } from "@/lib/wh/tables";
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
  const [token, setToken] = useState("");

  const save = useServerFn(whSaveCredential);
  const test = useServerFn(whTestConnection);
  const discover = useServerFn(whDiscoverCommunities);
  const sync = useServerFn(whRunSync);
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

  const runSync = useMutation({
    mutationFn: async (mode: "full" | "incremental") =>
      sync({ data: { connectionId: connectionId!, mode } }),
    onSuccess: async (r) => {
      if (!r.ok) toast.error(r.message ?? "Sync failed");
      else if (r.status === "partial")
        toast.warning(
          `Sync completed with issues: ${r.results
            .filter((x: any) => x.status !== "success")
            .map((x: any) => x.table)
            .join(", ")}`,
        );
      else toast.success("Sync completed");
      await seed({ data: { connectionId: connectionId! } });
      syncState.refetch();
      runs.refetch();
      qc.invalidateQueries({ queryKey: ["wh_lookups"] });
      qc.invalidateQueries({ queryKey: ["wh_activity_mappings"] });
      qc.invalidateQueries({ queryKey: ["wh_score_mappings"] });
      qc.invalidateQueries({ queryKey: ["wh_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
                  Full sync retrieves every mapped community. Incremental sync uses each table's own
                  watermark with a safety overlap, and source-ID upsert keeps it idempotent.
                </p>
              </div>
              <div className="flex gap-2">
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
                  onClick={() => runSync.mutate("incremental")}
                  disabled={!credential.data?.configured || runSync.isPending}
                >
                  <RefreshCw className="size-4" /> Incremental sync
                </Button>
                <Button
                  size="sm"
                  onClick={() => runSync.mutate("full")}
                  disabled={!credential.data?.configured || runSync.isPending}
                >
                  Full sync
                </Button>
              </div>
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
            <h2 className="text-sm font-semibold">Recent table runs</h2>
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
