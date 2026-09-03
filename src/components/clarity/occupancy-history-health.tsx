import { format } from "date-fns";
import { EmptyState } from "@/components/clarity/empty-state";
import { DataTable } from "@/components/clarity/data-table";
import {
  OCC_HISTORY_CUTOFF,
  useOccHistoryHealth,
  type OccHistoryHealthRow,
} from "@/lib/occupancy-history/queries";

/**
 * Coverage of the official day-over-day occupancy backfill. Purely a health
 * read-out: it never changes how occupancy is calculated, and it never claims
 * coverage for a day that has no stored record.
 */
export function OccupancyHistoryHealthSection({ organizationId }: { organizationId: string | null }) {
  const q = useOccHistoryHealth(organizationId, []);
  const rows = (q.data ?? []).filter((r) => r.record_count > 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Official occupancy history coverage</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Imported before {OCC_HISTORY_CUTOFF}
        </span>
      </div>
      {q.isLoading ? (
        <div className="panel h-32 animate-pulse" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No official occupancy history imported"
          description="Historical occupancy before nightly snapshots began comes from the official day-over-day workbooks. Import them in Admin → Occupancy History Import; nothing is reconstructed in the meantime."
        />
      ) : (
        <DataTable
          rows={rows}
          empty={<p className="p-6 text-sm text-muted-foreground">No coverage.</p>}
          columns={[
            { key: "c", header: "Community", render: (r: OccHistoryHealthRow) => r.community_name },
            { key: "f", header: "First day", render: (r: OccHistoryHealthRow) => r.first_date ?? "—" },
            { key: "l", header: "Last day", render: (r: OccHistoryHealthRow) => r.last_date ?? "—" },
            {
              key: "n",
              header: "Days stored",
              align: "right",
              render: (r: OccHistoryHealthRow) => r.record_count,
            },
            {
              key: "m",
              header: "Gaps",
              align: "right",
              render: (r: OccHistoryHealthRow) =>
                r.missing_days ? (
                  <span className="text-warning">{r.missing_days}</span>
                ) : (
                  "—"
                ),
            },
            {
              key: "w",
              header: "Flagged rows",
              align: "right",
              render: (r: OccHistoryHealthRow) =>
                r.warning_count ? <span className="text-warning">{r.warning_count}</span> : "—",
            },
            {
              key: "i",
              header: "Last import",
              render: (r: OccHistoryHealthRow) =>
                r.last_import_at ? format(new Date(r.last_import_at), "MMM d, yyyy") : "—",
            },
          ]}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Nightly snapshots always take precedence over imported history for the same date. Flagged rows keep the
        source values exactly as supplied and are never corrected automatically.
      </p>
    </section>
  );
}
