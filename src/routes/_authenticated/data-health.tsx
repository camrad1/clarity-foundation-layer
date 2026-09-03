import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow, format } from "date-fns";
import { Database } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { useConnections, useSourceTypes, useSyncRuns } from "@/lib/clarity-queries";
import { fmtInt } from "@/lib/gsc/format";
import { GRAIN_LABELS, type GrainKey } from "@/lib/gsc/parse";
import { useActiveGrainCoverage } from "@/lib/gsc/queries";
import { WhCompletenessPanel } from "@/components/clarity/wh-completeness";
import { WhHealthSection } from "@/components/clarity/wh-health";
import { SnapshotHealthSection } from "@/components/clarity/snapshot-health";
import { OccupancyHistoryHealthSection } from "@/components/clarity/occupancy-history-health";
import { WhLookupCoveragePanel } from "@/components/clarity/wh-lookup-coverage";
import { OccupancyReconciliationPanel } from "@/components/clarity/occupancy-reconciliation";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/data-health")({
  head: () => ({
    meta: [
      { title: "Data Health — ClarityIQ" },
      {
        name: "description",
        content:
          "Connection status, sync freshness and import results for every ClarityIQ data source.",
      },
      { property: "og:title", content: "Data Health — ClarityIQ" },
      {
        property: "og:description",
        content: "Know exactly how fresh and how complete your performance data is.",
      },
    ],
  }),
  component: DataHealth,
});

function relative(ts: string | null) {
  if (!ts) return "Never";
  return `${formatDistanceToNow(new Date(ts))} ago`;
}

function DataHealth() {
  const { organizationId } = useAppState();
  const connections = useConnections(organizationId);
  const sourceTypes = useSourceTypes();
  const runs = useSyncRuns(organizationId);
  const coverage = useActiveGrainCoverage(organizationId);
  const activeGrainRows = coverage.data ?? [];

  /** Per-grain coverage — grains are never merged into one implied range. */
  const perGrain = (Object.keys(GRAIN_LABELS) as GrainKey[]).map((grain) => {
    const rows = activeGrainRows.filter((r) => r.grain === grain);
    const starts = rows.map((r) => r.period_start).filter(Boolean).sort() as string[];
    const ends = rows.map((r) => r.period_end).filter(Boolean).sort() as string[];
    const lastImport = rows
      .map((r) => r.imported_at)
      .filter(Boolean)
      .sort()
      .at(-1) as string | undefined;
    return {
      grain,
      active: rows.length > 0,
      start: starts[0] ?? null,
      end: ends.at(-1) ?? null,
      rowCount: rows.reduce((n, r) => n + (r.row_count ?? 0), 0),
      files: rows.length,
      lastImport: lastImport ?? null,
    };
  });
  const datesCoverage = perGrain.find((g) => g.grain === "daily")!;
  const lastActiveImport = activeGrainRows
    .map((r) => r.imported_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;


  const typeName = (key: string) =>
    (sourceTypes.data ?? []).find((t) => t.key === key)?.name ?? key;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Data Health"
        description="Every source reports its own connection state, freshness and last import result. Nothing downstream should be trusted beyond what this page reports."
      />

      {connections.isLoading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (connections.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No data sources connected"
          description="Add a connection in Admin → Data Sources. Search Console and Further can start as manual uploads; WelcomeHome can be registered as an API connection placeholder."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(connections.data ?? []).map((c) => {
            const latest = (runs.data ?? []).find((r) => r.connection_id === c.id);
            return (
              <article key={c.id} className="panel space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{typeName(c.source_type)}</p>
                    <h3 className="text-base font-semibold text-foreground">{c.display_name}</h3>
                  </div>
                  <StatusPill status={c.status} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Last successful sync</dt>
                    <dd className="text-foreground">{relative(c.last_successful_sync_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last attempted sync</dt>
                    <dd className="text-foreground">{relative(c.last_attempted_sync_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Data through</dt>
                    <dd className="text-foreground">
                      {c.data_through_date
                        ? format(new Date(`${c.data_through_date}T00:00:00`), "MMM d, yyyy")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latest run</dt>
                    <dd className="text-foreground">
                      {latest ? <StatusPill status={latest.status} /> : "No runs yet"}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  {latest ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Received {latest.records_received}</span>
                      <span>Inserted {latest.records_inserted}</span>
                      <span>Updated {latest.records_updated}</span>
                      <span
                        className={latest.records_failed > 0 ? "text-destructive" : undefined}
                      >
                        Failed {latest.records_failed}
                      </span>
                      {latest.error_summary ? (
                        <span className="w-full text-destructive">{latest.error_summary}</span>
                      ) : null}
                    </div>
                  ) : (
                    "No import has run for this connection yet."
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Search Console active coverage</h2>
        {coverage.isLoading ? (
          <div className="panel px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !activeGrainRows.length ? (
          <EmptyState
            title="No active Search Console coverage"
            description="Upload an export in Admin → Search Console Imports. Superseded or failed imports never count as coverage, so Search Intelligence stays empty until an active export exists."
          />
        ) : (
          <div className="panel space-y-4 p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Dates report coverage</dt>
                <dd className="text-foreground">
                  {datesCoverage.start && datesCoverage.end
                    ? `${format(new Date(`${datesCoverage.start}T00:00:00`), "MMM d, yyyy")} – ${format(new Date(`${datesCoverage.end}T00:00:00`), "MMM d, yyyy")}`
                    : "No active Dates report"}
                </dd>
                <dd className="text-xs text-muted-foreground">Used by Search Overview totals.</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last successful import</dt>
                <dd className="text-foreground">{relative(lastActiveImport ?? null)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Active files</dt>
                <dd className="text-foreground">
                  {fmtInt(new Set(activeGrainRows.map((r) => r.file_name)).size)}
                </dd>
              </div>
            </dl>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium">Report grain</th>
                    <th className="py-2 text-left font-medium">Active coverage</th>
                    <th className="py-2 text-right font-medium">Rows</th>
                    <th className="py-2 text-right font-medium">Active files</th>
                  </tr>
                </thead>
                <tbody>
                  {perGrain.map((g) => (
                    <tr key={g.grain} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-foreground">{GRAIN_LABELS[g.grain]}</td>
                      <td className="py-2 text-muted-foreground">
                        {g.active && g.start && g.end
                          ? `${format(new Date(`${g.start}T00:00:00`), "MMM d, yyyy")} – ${format(new Date(`${g.end}T00:00:00`), "MMM d, yyyy")}`
                          : "No active export"}
                      </td>
                      <td className="py-2 text-right text-foreground">
                        {g.active ? fmtInt(g.rowCount) : "—"}
                      </td>
                      <td className="py-2 text-right text-foreground">
                        {g.active ? fmtInt(g.files) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Each report grain is stored and reported separately and can cover a different period.
              Superseded imports stay in Import History but never contribute to active coverage.
            </p>
          </div>
        )}
      </section>

      <WhHealthSection organizationId={organizationId} />
      <SnapshotHealthSection organizationId={organizationId} />
      <OccupancyHistoryHealthSection organizationId={organizationId} />
      <WhCompletenessPanel />
      <WhLookupCoveragePanel />
      <OccupancyReconciliationPanel />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Coverage</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {["Marketing data coverage", "Sales funnel coverage", "Move-in attribution coverage"].map(
            (label) => (
              <article key={label} className="panel p-5">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Not yet measurable. Coverage is computed once source data is flowing; no
                  placeholder percentage is shown.
                </p>
              </article>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
