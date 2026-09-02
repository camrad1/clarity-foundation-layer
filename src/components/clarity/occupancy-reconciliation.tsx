import { AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { useWhContext } from "@/lib/wh/use-wh";
import { useCurrentOccupancy, type CommunityOccupancy } from "@/lib/wh/occupancy";

/**
 * Occupancy reconciliation diagnostic.
 *
 * Compares the admin-configured operational unit count against the WelcomeHome
 * source unit records and the census-eligible denominator, per community. The
 * configured value never silently replaces the source denominator — a
 * difference is surfaced here instead.
 */
export function OccupancyReconciliationPanel() {
  const ctx = useWhContext();
  const occ = useCurrentOccupancy(ctx.organizationId, ctx.communityIds);
  const rows = occ.data?.communities ?? [];
  const flagged = rows.filter((r) => r.unit_count_discrepancy || r.census_units === 0);

  if (!ctx.connection) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Occupancy reconciliation</h2>
        <p className="text-xs text-muted-foreground">
          Current-state occupancy per community, with the configured operational unit count checked
          against the WelcomeHome census denominator.{" "}
          {occ.isLoading
            ? "Checking…"
            : flagged.length === 0
              ? "Every community reconciles."
              : `${flagged.length} community/communities need attention.`}
        </p>
      </div>
      <DataTable
        loading={occ.isLoading}
        rows={rows}
        empty={
          <p className="p-6 text-sm text-muted-foreground">
            No WelcomeHome unit records for this selection yet.
          </p>
        }
        columns={[
          { key: "name", header: "Community", render: (r: CommunityOccupancy) => r.name },
          {
            key: "cfg",
            header: "Configured units",
            align: "right",
            render: (r: CommunityOccupancy) => r.configured_units ?? "—",
          },
          {
            key: "src",
            header: "Source unit records",
            align: "right",
            render: (r: CommunityOccupancy) => r.total_unit_records,
          },
          {
            key: "census",
            header: "Census-eligible",
            align: "right",
            render: (r: CommunityOccupancy) => r.census_units,
          },
          {
            key: "occ",
            header: "Occupied",
            align: "right",
            render: (r: CommunityOccupancy) => r.occupied_units,
          },
          {
            key: "pct",
            header: "Occupancy",
            align: "right",
            render: (r: CommunityOccupancy) =>
              r.occupancy_pct == null ? "—" : `${(Number(r.occupancy_pct) * 100).toFixed(1)}%`,
          },
          {
            key: "flag",
            header: "Status",
            render: (r: CommunityOccupancy) =>
              r.census_units === 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> No unit records — occupancy withheld
                </span>
              ) : r.unit_count_discrepancy ? (
                <span className="inline-flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> Configured {r.configured_units} ≠ census{" "}
                  {r.census_units}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Reconciled</span>
              ),
          },
        ]}
      />
    </section>
  );
}
