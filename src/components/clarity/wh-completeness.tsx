import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { useWhCompleteness } from "@/lib/wh/summary";
import { useWhContext } from "@/lib/wh/use-wh";

/**
 * Internal consistency check: how many rows of each WelcomeHome table are
 * stored for the authorized selection, next to what the most recent sync
 * persisted for that table.
 *
 * These are deliberately different questions — lifetime stored volume is not
 * the same as one incremental run — so they are labelled separately and never
 * subtracted from each other.
 */
export function WhCompletenessPanel() {
  const ctx = useWhContext();
  const rows = useWhCompleteness(ctx.organizationId, ctx.communityIds);

  if (!ctx.connection) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">WelcomeHome stored volume</h2>
        <p className="text-xs text-muted-foreground">
          Dashboard metrics are aggregated by the database over these full row counts. If a KPI ever
          disagrees with the stored volume, the discrepancy is a query-scope bug, not a rounding
          difference.
        </p>
      </div>
      <DataTable
        columns={[
          { key: "t", header: "Source table", render: (r: any) => r.source_table },
          {
            key: "stored",
            header: "Rows stored (selection)",
            align: "right",
            render: (r: any) => Number(r.stored_rows).toLocaleString(),
          },
          {
            key: "run",
            header: "Last sync persisted",
            align: "right",
            render: (r: any) =>
              r.last_sync_rows == null ? "—" : Number(r.last_sync_rows).toLocaleString(),
          },
          {
            key: "at",
            header: "Last run",
            render: (r: any) => (
              <span className="text-xs text-muted-foreground">
                {r.last_sync_at ? r.last_sync_at.slice(0, 16).replace("T", " ") : "—"}
              </span>
            ),
          },
        ]}
        rows={(rows.data ?? []) as any[]}
        loading={rows.isLoading}
        empty={<EmptyState title="No WelcomeHome records stored yet" />}
      />
    </section>
  );
}
