import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WH_CORE_TABLES, WH_LOOKUP_SOURCE } from "@/lib/wh/tables";
import type { WhSyncRunRecord, WhSyncRunUnit } from "@/lib/wh/queries";

/**
 * Overall sync completion.
 *
 * The detailed work-unit tables stay authoritative for audit; this module
 * answers the one question an admin actually asks first — did the run finish?
 * A run is Complete ONLY when every planned unit has a terminal clean status
 * (success, or an explicitly acceptable unsupported/skipped). Any unit still
 * pending or running keeps the run out of Complete by construction.
 */

export type OverallStatus = "running" | "complete" | "partial" | "failed" | "canceled";

const ACCOUNT_TABLES = new Set(
  Object.entries(WH_LOOKUP_SOURCE)
    .filter(([, v]) => v.kind === "json")
    .map(([k]) => k),
);

export type CommunityCompletion = {
  communityId: string | null;
  name: string;
  planned: number;
  successful: number;
  failed: number;
  pending: number;
  failedTables: string[];
  status: OverallStatus;
};

export type RunSummary = {
  id: string;
  status: OverallStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  planned: number;
  successful: number;
  unsupported: number;
  failed: number;
  pending: number;
  failedUnits: { table: string; communityId: string | null; communityName: string | null }[];
  communities: CommunityCompletion[];
  communityNames: string[];
  mode: string | null;
};

function unitKey(u: { source_table: string; community_id: string | null }) {
  return `${u.source_table}:${u.community_id ?? "*"}`;
}

function latestUnits(units: WhSyncRunUnit[]) {
  const map = new Map<string, WhSyncRunUnit>();
  for (const u of units) map.set(unitKey(u), u);
  return [...map.values()];
}

export function summarizeRun(
  run: WhSyncRunRecord,
  nameOf: (communityId: string) => string,
): RunSummary {
  const units = latestUnits(run.units ?? []);
  const cursor = run.sync_cursor ?? {};
  const tables = (cursor.tables ?? []) as string[];
  const communityIds = (cursor.communityIds ?? []) as string[];
  const communityTables = tables.filter((t) => !ACCOUNT_TABLES.has(t));
  const accountTables = tables.filter((t) => ACCOUNT_TABLES.has(t));
  const planned =
    cursor.totalUnits ??
    (tables.length ? accountTables.length + communityTables.length * communityIds.length : units.length);

  const isClean = (s: string) => s === "success" || s === "unsupported";
  const isFailed = (s: string) => s === "failed" || s === "partial";

  const successful = units.filter((u) => u.status === "success").length;
  const unsupported = units.filter((u) => u.status === "unsupported").length;
  const failedList = units.filter((u) => isFailed(u.status));
  const pending = Math.max(0, planned - units.filter((u) => isClean(u.status) || isFailed(u.status)).length);

  const live = run.status === "running" || run.status === "queued";
  let status: OverallStatus;
  if (run.status === "canceled") status = "canceled";
  else if (live) status = "running";
  else if (run.status === "failed" || (units.length > 0 && failedList.length === units.length))
    status = "failed";
  else if (pending > 0 || failedList.length > 0) status = "partial";
  else status = "complete";

  const communities: CommunityCompletion[] = communityIds.map((cid) => {
    const own = units.filter((u) => u.community_id === cid);
    const ok = own.filter((u) => isClean(u.status)).length;
    const bad = own.filter((u) => isFailed(u.status));
    const plannedHere = communityTables.length || own.length;
    const pend = Math.max(0, plannedHere - own.length);
    return {
      communityId: cid,
      name: nameOf(cid),
      planned: plannedHere,
      successful: ok,
      failed: bad.length,
      pending: pend,
      failedTables: bad.map((b) => b.source_table),
      status: live && pend > 0 ? "running" : bad.length ? "partial" : pend ? "partial" : "complete",
    };
  });

  if (accountTables.length) {
    const own = units.filter((u) => u.community_id === null);
    const ok = own.filter((u) => isClean(u.status)).length;
    const bad = own.filter((u) => isFailed(u.status));
    const pend = Math.max(0, accountTables.length - own.length);
    communities.push({
      communityId: null,
      name: "Account-wide lookups",
      planned: accountTables.length,
      successful: ok,
      failed: bad.length,
      pending: pend,
      failedTables: bad.map((b) => b.source_table),
      status: live && pend > 0 ? "running" : bad.length || pend ? "partial" : "complete",
    });
  }

  const durationMs =
    run.started_at && run.completed_at
      ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
      : run.started_at && live
        ? Date.now() - new Date(run.started_at).getTime()
        : null;

  return {
    id: run.id,
    status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs,
    planned,
    successful,
    unsupported,
    failed: failedList.length,
    pending,
    failedUnits: failedList.map((u) => ({
      table: u.source_table,
      communityId: u.community_id,
      communityName: u.community_id ? nameOf(u.community_id) : null,
    })),
    communities,
    communityNames: communityIds.map(nameOf),
    mode: (cursor.mode as string | undefined) ?? null,
  };
}

const STATUS_LABEL: Record<OverallStatus, string> = {
  running: "RUNNING",
  complete: "COMPLETE",
  partial: "PARTIAL",
  failed: "FAILED",
  canceled: "CANCELED",
};

export function OverallStatusBadge({ status, large }: { status: OverallStatus; large?: boolean }) {
  const tone =
    status === "complete"
      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : status === "running"
        ? "bg-primary/10 text-primary border-primary/30"
        : status === "failed"
          ? "bg-destructive/10 text-destructive border-destructive/30"
          : status === "canceled"
            ? "bg-muted text-muted-foreground border-border"
            : "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/30";
  const Icon =
    status === "complete"
      ? CheckCircle2
      : status === "running"
        ? Loader2
        : status === "failed"
          ? XCircle
          : AlertTriangle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        tone,
        large ? "px-3 py-1 text-sm tracking-wide" : "px-2 py-0.5 text-[11px]",
      )}
    >
      <Icon className={cn(large ? "size-4" : "size-3", status === "running" && "animate-spin")} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function fmtTime(v: string | null) {
  return v ? format(new Date(v), "MMM d h:mm a") : "—";
}

function fmtDuration(ms: number | null) {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold", tone)}>{value}</p>
    </div>
  );
}

function CommunityRows({ summary }: { summary: RunSummary }) {
  if (!summary.communities.length) return null;
  return (
    <ul className="space-y-1.5">
      {summary.communities.map((c) => (
        <li
          key={c.communityId ?? "account"}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          {c.status === "complete" ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : c.status === "running" ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          )}
          <span className="font-medium">{c.name}</span>
          <span className="text-muted-foreground">
            {c.status === "complete"
              ? "Complete"
              : c.status === "running"
                ? "Running"
                : "Partial"}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {c.successful}/{c.planned}
          </span>
          {c.failedTables.length ? (
            <span className="text-xs text-destructive">failed: {c.failedTables.join(", ")}</span>
          ) : null}
          {c.pending ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">{c.pending} pending</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Prominent latest-run panel. */
export function SyncRunSummary({
  summary,
  onRetryFailed,
  busy,
}: {
  summary: RunSummary | null;
  onRetryFailed?: ((summary: RunSummary) => void) | undefined;
  busy?: boolean | undefined;
}) {
  if (!summary) {
    return (
      <section className="panel p-5">
        <p className="eyebrow">Latest sync</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No sync run recorded yet. Run a full sync to establish a baseline.
        </p>
      </section>
    );
  }
  const headline = `${summary.successful + summary.unsupported}/${summary.planned} work units successful`;
  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow">Latest sync</p>
        <OverallStatusBadge status={summary.status} large />
        {summary.mode ? (
          <span className="text-xs text-muted-foreground">{summary.mode} mode</span>
        ) : null}
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {summary.communities.filter((c) => c.communityId).length} communities
        </span>
        {" · "}
        {headline}
        {" · "}
        {summary.failed} failed
        {" · "}
        {summary.pending} pending
        {summary.unsupported ? ` · ${summary.unsupported} unsupported/skipped` : ""}
      </p>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Started" value={fmtTime(summary.startedAt)} />
        <Stat label="Completed" value={fmtTime(summary.completedAt)} />
        <Stat label="Duration" value={fmtDuration(summary.durationMs)} />
        <Stat
          label="Successful"
          value={String(summary.successful)}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Stat label="Failed" value={String(summary.failed)} tone={summary.failed ? "text-destructive" : ""} />
        <Stat
          label="Pending / running"
          value={String(summary.pending)}
          tone={summary.pending ? "text-amber-600 dark:text-amber-400" : ""}
        />
      </div>

      <CommunityRows summary={summary} />

      {(summary.status === "partial" || summary.status === "failed") && summary.failedUnits.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm">
            {summary.failedUnits.length} work unit
            {summary.failedUnits.length === 1 ? "" : "s"} require attention:{" "}
            {summary.failedUnits
              .slice(0, 4)
              .map((u) => `${u.table}${u.communityName ? ` (${u.communityName})` : ""}`)
              .join(", ")}
            {summary.failedUnits.length > 4 ? "…" : ""}
          </span>
          {onRetryFailed ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetryFailed(summary)}>
              Retry failed work units
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A run is Complete only when every planned work unit finished successfully or was explicitly
        unsupported. Successful work is never re-run by a retry.
      </p>
    </section>
  );
}

/** Compact history so it is obvious which community batches already synced. */
export function RecentSyncRuns({
  summaries,
  loading,
  onRetryFailed,
  busy,
}: {
  summaries: RunSummary[];
  loading?: boolean | undefined;
  onRetryFailed?: ((summary: RunSummary) => void) | undefined;
  busy?: boolean | undefined;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Recent sync runs</h2>
      <DataTable
        loading={!!loading}
        rows={summaries as any[]}
        empty={<p className="p-6 text-sm text-muted-foreground">No sync runs recorded yet.</p>}
        columns={[
          {
            key: "run",
            header: "Run",
            render: (r: RunSummary) => (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-left font-medium hover:underline"
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                {open === r.id ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {fmtTime(r.startedAt)}
              </button>
            ),
          },
          {
            key: "communities",
            header: "Communities",
            render: (r: RunSummary) => (
              <span className="text-xs text-muted-foreground">
                {r.communityNames.length ? r.communityNames.join(", ") : "—"}
              </span>
            ),
          },
          { key: "status", header: "Status", render: (r: RunSummary) => <OverallStatusBadge status={r.status} /> },
          {
            key: "units",
            header: "Work units",
            align: "right",
            render: (r: RunSummary) => (
              <span className="tabular-nums">
                {r.successful + r.unsupported}/{r.planned}
                {r.failed ? <span className="text-destructive"> · {r.failed} failed</span> : null}
              </span>
            ),
          },
          {
            key: "finished",
            header: "Finished",
            render: (r: RunSummary) => <span className="text-xs">{fmtTime(r.completedAt)}</span>,
          },
          {
            key: "actions",
            header: "Actions",
            render: (r: RunSummary) => (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  View
                </Button>
                {(r.status === "partial" || r.status === "failed") && r.failedUnits.length && onRetryFailed ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetryFailed(r)}>
                    Retry failed
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      {open ? (
        <div className="panel space-y-2 p-4">
          <p className="eyebrow">Run detail</p>
          {(() => {
            const s = summaries.find((x) => x.id === open);
            return s ? <CommunityRows summary={s} /> : null;
          })()}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Per-community freshness derived from the persisted sync state.
 * A community is Complete only when every required core table has a clean,
 * error-free last run.
 */
export function CommunitySyncOverview({
  syncState,
  nameOf,
  communityIds,
  loading,
}: {
  syncState: any[];
  nameOf: (id: string) => string;
  communityIds: string[];
  loading?: boolean | undefined;
}) {
  const rows = useMemo(() => {
    const required = WH_CORE_TABLES as readonly string[];
    return communityIds.map((cid) => {
      const own = (syncState ?? []).filter((r) => r.community_id === cid);
      const byTable = new Map(own.map((r) => [r.source_table, r]));
      let done = 0;
      const failedTables: string[] = [];
      const pendingTables: string[] = [];
      let oldestSuccess: number | null = null;
      for (const t of required) {
        const row = byTable.get(t);
        if (row && !row.error_summary && row.last_successful_at) {
          done += 1;
          const ts = new Date(row.last_successful_at).getTime();
          oldestSuccess = oldestSuccess == null ? ts : Math.min(oldestSuccess, ts);
        } else if (row?.error_summary) failedTables.push(t);
        else pendingTables.push(t);
      }
      const status: OverallStatus =
        done === required.length ? "complete" : failedTables.length ? "partial" : done ? "partial" : "failed";
      return {
        communityId: cid,
        name: nameOf(cid),
        status,
        done,
        total: required.length,
        failedTables,
        pendingTables,
        lastFullSync: oldestSuccess && done === required.length ? new Date(oldestSuccess).toISOString() : null,
      };
    });
  }, [syncState, communityIds, nameOf]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Community overview</h2>
        <p className="text-xs text-muted-foreground">
          A community shows Complete only when every required table has a clean, successful run.
        </p>
      </div>
      <DataTable
        loading={!!loading}
        rows={rows as any[]}
        empty={<p className="p-6 text-sm text-muted-foreground">No mapped communities yet.</p>}
        columns={[
          { key: "name", header: "Community", render: (r: any) => <span className="font-medium">{r.name}</span> },
          { key: "status", header: "Sync status", render: (r: any) => <OverallStatusBadge status={r.status} /> },
          {
            key: "last",
            header: "Last successful full sync",
            render: (r: any) => <span className="text-xs">{r.lastFullSync ? fmtTime(r.lastFullSync) : "—"}</span>,
          },
          {
            key: "req",
            header: "Required tables complete",
            align: "right",
            render: (r: any) => (
              <span className="tabular-nums">
                {r.done}/{r.total}
              </span>
            ),
          },
          {
            key: "detail",
            header: "Attention",
            render: (r: any) => (
              <span className="text-xs text-muted-foreground">
                {r.failedTables.length ? (
                  <span className="text-destructive">failed: {r.failedTables.join(", ")}</span>
                ) : r.pendingTables.length ? (
                  `pending: ${r.pendingTables.join(", ")}`
                ) : (
                  "—"
                )}
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}
