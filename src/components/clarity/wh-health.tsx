import { format } from "date-fns";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { StatusPill } from "@/components/clarity/status-pill";
import { useCommunities } from "@/lib/clarity-queries";
import {
  useWhConnection,
  useWhSourceCommunities,
  useWhSyncState,
} from "@/lib/wh/queries";
import { WH_CORE_TABLES } from "@/lib/wh/tables";

/** WelcomeHome freshness, sync outcome and mapping completeness for Data Health. */
export function WhHealthSection({ organizationId }: { organizationId: string | null }) {
  const connection = useWhConnection(organizationId);
  const connectionId = connection.data?.id ?? null;
  const syncState = useWhSyncState(connectionId);
  const discovered = useWhSourceCommunities(connectionId);
  const communities = useCommunities(organizationId);

  if (!connection.data) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">WelcomeHome freshness</h2>
        <EmptyState
          title="WelcomeHome is not connected"
          description="Sales and occupancy data health appears once the CRM connection exists."
        />
      </section>
    );
  }

  const rows = (syncState.data ?? []) as any[];
  const core = rows.filter((r) => (WH_CORE_TABLES as readonly string[]).includes(r.source_table));
  const failing = rows.filter((r) => r.error_summary);
  const stale = core.filter(
    (r) =>
      !r.last_successful_at ||
      Date.now() - new Date(r.last_successful_at).getTime() > 36 * 3600 * 1000,
  );
  const unmapped = (discovered.data ?? []).length;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">WelcomeHome freshness</h2>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="panel space-y-1 p-5">
          <p className="eyebrow">Connection</p>
          <StatusPill status={connection.data.status} />
          <p className="pt-2 text-xs text-muted-foreground">
            Last success{" "}
            {connection.data.last_successful_sync_at
              ? format(new Date(connection.data.last_successful_sync_at), "MMM d, h:mm a")
              : "never"}
          </p>
        </div>
        <div className="panel space-y-1 p-5">
          <p className="eyebrow">Data through</p>
          <p className="font-display text-xl font-semibold">
            {connection.data.data_through_date ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            Sales figures after this date are incomplete by definition.
          </p>
        </div>
        <div className="panel space-y-1 p-5">
          <p className="eyebrow">Core tables stale</p>
          <p className="font-display text-xl font-semibold">
            {stale.length} of {core.length || WH_CORE_TABLES.length}
          </p>
          <p className="text-xs text-muted-foreground">No successful sync in the last 36 hours.</p>
        </div>
        <div className="panel space-y-1 p-5">
          <p className="eyebrow">Tables failing</p>
          <p className="font-display text-xl font-semibold">{failing.length}</p>
          <p className="text-xs text-muted-foreground">
            A partial sync never silently reduces a metric — affected tables are listed below.
          </p>
        </div>
      </div>

      <DataTable
        columns={[
          { key: "t", header: "Table", render: (r: any) => r.source_table },
          {
            key: "s",
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
          {
            key: "l",
            header: "Last success",
            render: (r: any) => (
              <span className="text-xs">
                {r.last_successful_at
                  ? format(new Date(r.last_successful_at), "MMM d, yyyy h:mm a")
                  : "Never"}
              </span>
            ),
          },
          { key: "rows", header: "Rows received", align: "right", render: (r: any) => r.rows_received },
          { key: "fail", header: "Rows failed", align: "right", render: (r: any) => r.rows_failed },
          {
            key: "e",
            header: "Detail",
            render: (r: any) => (
              <span className="text-xs text-muted-foreground">{r.error_summary ?? "—"}</span>
            ),
          },
        ]}
        rows={rows}
        loading={syncState.isLoading}
        empty={
          <EmptyState
            title="No synchronization yet"
            description="Map communities and run a full sync to populate CRM data health."
          />
        }
      />

      <p className="text-xs text-muted-foreground">
        {unmapped} WelcomeHome communities discovered · {(communities.data ?? []).length} ClarityIQ
        communities in this organization. Unmapped communities are excluded from ingestion, so their
        absence is a mapping gap rather than a data gap.
      </p>
    </section>
  );
}
