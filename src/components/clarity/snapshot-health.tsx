import { DataTable } from "@/components/clarity/data-table";
import { useSnapshotHealth, useNightlyRuns } from "@/lib/wh/snapshots";
import { useWhContext } from "@/lib/wh/use-wh";

/**
 * Nightly refresh + daily snapshot health. Surfaces missing snapshots, stale
 * source data and the last failure reason per community, so a silent nightly
 * failure is visible instead of quietly leaving a hole in history.
 */
export function SnapshotHealthSection({ organizationId }: { organizationId: string | null }) {
  const ctx = useWhContext();
  const health = useSnapshotHealth(organizationId, ctx.communityIds);
  const runs = useNightlyRuns(organizationId, 5);

  const rows = health.data ?? [];
  const missing = rows.filter((r) => r.snapshot_missing).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Nightly snapshots</h2>
        {missing > 0 ? (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            {missing} community{missing === 1 ? "" : "s"} missing today's snapshot
          </span>
        ) : rows.length ? (
          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            Up to date
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        One immutable snapshot per community per local calendar date. A snapshot is only written after the
        required current-state datasets refreshed cleanly — a failed night records the reason instead of a
        number.
      </p>

      <DataTable
        rows={rows}
        empty={<p className="p-6 text-sm text-muted-foreground">No mapped communities in scope.</p>}
        columns={[
          { key: "c", header: "Community", render: (r: any) => r.community_name },
          {
            key: "last",
            header: "Last snapshot",
            render: (r: any) =>
              r.last_snapshot_date ? (
                <span className={r.snapshot_missing ? "text-destructive" : undefined}>
                  {r.last_snapshot_date}
                  {r.days_behind ? ` (${r.days_behind}d behind)` : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">None yet</span>
              ),
          },
          { key: "n", header: "Snapshots", align: "right", render: (r: any) => r.snapshot_count },
          {
            key: "first",
            header: "History from",
            render: (r: any) => r.first_snapshot_date ?? "—",
          },
          {
            key: "sync",
            header: "Source freshness",
            render: (r: any) =>
              r.source_stale ? (
                <span className="text-warning">Stale</span>
              ) : (
                <span className="text-muted-foreground">Fresh</span>
              ),
          },
          {
            key: "fail",
            header: "Last failure",
            render: (r: any) =>
              r.last_failure_date ? (
                <span className="text-destructive" title={r.last_failure_reason ?? undefined}>
                  {r.last_failure_date}
                </span>
              ) : (
                "—"
              ),
          },
        ]}
      />

      {runs.data?.length ? (
        <div className="panel p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent nightly runs
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {runs.data.map((r) => (
              <li key={r.id}>
                <span className="font-medium text-foreground">{r.run_date}</span> · {r.status} ·{" "}
                {r.communities_done}/{r.communities_total} communities · {r.snapshots_written} snapshots
                {r.communities_failed ? ` · ${r.communities_failed} failed` : ""}
                {r.error ? ` · ${r.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
