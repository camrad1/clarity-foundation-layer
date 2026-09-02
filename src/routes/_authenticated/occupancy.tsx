import { createFileRoute } from "@tanstack/react-router";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { ProgressGauge } from "@/components/clarity/charts";
import { useWhContext } from "@/lib/wh/use-wh";
import {
  effectiveBudget,
  resolveBudget,
  useOccupancyWithBudget,
  type CommunityOccupancy,
} from "@/lib/wh/occupancy";

export const Route = createFileRoute("/_authenticated/occupancy")({
  head: () => ({
    meta: [
      { title: "Occupancy Intelligence — ClarityIQ" },
      {
        name: "description",
        content: "Current occupancy, vacancy, notices and budget variance by community and care type.",
      },
      { property: "og:title", content: "Occupancy Intelligence — ClarityIQ" },
      {
        property: "og:description",
        content: "Current-state occupancy versus budget for every community.",
      },
    ],
  }),
  component: Occupancy,
});

function pct1(v: number | null | undefined) {
  return v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;
}

function Occupancy() {
  const ctx = useWhContext();
  const { occupancy, budgetRows } = useOccupancyWithBudget(ctx.organizationId, ctx.communityIds);
  const data = occupancy.data;
  const rows = data?.communities ?? [];
  const totals = data?.totals;

  const portfolioBudget = rows.reduce(
    (acc, r) => {
      const b = resolveBudget(effectiveBudget(budgetRows, r.id), r.census_units, r.occupied_units);
      return b.units == null ? acc : { units: (acc.units ?? 0) + b.units, any: true };
    },
    { units: null as number | null, any: false },
  );
  const budgetPct =
    portfolioBudget.units != null && totals?.censusUnits
      ? portfolioBudget.units / totals.censusUnits
      : null;
  const actualPct = totals?.occupancyPct == null ? null : Number(totals.occupancyPct);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Occupancy"
        title="Occupancy Intelligence"
        description="Current occupancy from WelcomeHome unit and housing-contract state, using the same calculation as Sales Intelligence and the Flash Report."
      />

      {occupancy.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : !totals || totals.totalUnitRecords === 0 ? (
        <EmptyState
          title="No unit records for this selection"
          description="Sync the WelcomeHome Units dataset for the selected communities. Nothing is estimated to fill the gap."
        />
      ) : (
        <>
          <section className="panel space-y-5 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Portfolio current occupancy</h2>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Current state
              </span>
            </div>
            <ProgressGauge
              value={totals.occupiedUnits}
              total={totals.censusUnits}
              display={
                totals.censusUnits
                  ? `${Math.round((totals.occupiedUnits / totals.censusUnits) * 100)}%`
                  : "—"
              }
              caption={`${totals.occupiedUnits} of ${totals.censusUnits} census-eligible units occupied · ${pct1(actualPct)} raw${
                budgetPct != null
                  ? ` · budget ${pct1(budgetPct)} (${((actualPct! - budgetPct) * 100).toFixed(1)} pts)`
                  : " · no budget configured"
              }`}
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Census-eligible units" value={totals.censusUnits} />
              <Stat label="Occupied" value={totals.occupiedUnits} />
              <Stat label="Vacant" value={totals.vacantUnits} />
              <Stat label="On notice" value={totals.noticeUnits} />
              <Stat label="Reserved (future move-in)" value={totals.reservedUnits} />
              <Stat label="Pending move-ins" value={totals.pendingMoveIns} />
              <Stat label="Off census" value={totals.offCensusUnits} />
              <Stat label="Pseudo / non-residential" value={totals.pseudoUnits} />
            </div>
            <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              Current state as of {data?.asOf}. Not affected by the selected date range. Historical
              as-of-date occupancy requires the nightly snapshot system, which is not built yet.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">By community</h2>
            <DataTable
              rows={rows}
              empty={<p className="p-6 text-sm text-muted-foreground">No communities in scope.</p>}
              columns={[
                { key: "name", header: "Community", render: (r: CommunityOccupancy) => r.name },
                {
                  key: "census",
                  header: "Census units",
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
                  key: "vac",
                  header: "Vacant",
                  align: "right",
                  render: (r: CommunityOccupancy) => r.vacant_units,
                },
                {
                  key: "notice",
                  header: "Notice",
                  align: "right",
                  render: (r: CommunityOccupancy) => r.notice_units,
                },
                {
                  key: "res",
                  header: "Reserved",
                  align: "right",
                  render: (r: CommunityOccupancy) => r.reserved_units,
                },
                {
                  key: "pct",
                  header: "Occupancy",
                  align: "right",
                  render: (r: CommunityOccupancy) => pct1(r.occupancy_pct),
                },
                {
                  key: "bud",
                  header: "Budget",
                  align: "right",
                  render: (r: CommunityOccupancy) => {
                    const b = resolveBudget(
                      effectiveBudget(budgetRows, r.id),
                      r.census_units,
                      r.occupied_units,
                    );
                    return b.pct == null ? "—" : pct1(b.pct);
                  },
                },
                {
                  key: "var",
                  header: "Variance",
                  align: "right",
                  render: (r: CommunityOccupancy) => {
                    const b = resolveBudget(
                      effectiveBudget(budgetRows, r.id),
                      r.census_units,
                      r.occupied_units,
                    );
                    if (b.variancePoints == null) return "—";
                    const sign = b.variancePoints >= 0 ? "+" : "";
                    return (
                      <span className={b.variancePoints >= 0 ? "text-success" : "text-destructive"}>
                        {sign}
                        {b.variancePoints.toFixed(1)} pts
                      </span>
                    );
                  },
                },
              ]}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">By care type</h2>
            <DataTable
              rows={rows.flatMap((r) =>
                (r.by_care_type ?? []).map((c) => ({ ...c, community: r.name, key: `${r.id}-${c.careType}` })),
              )}
              empty={<p className="p-6 text-sm text-muted-foreground">No care types configured.</p>}
              columns={[
                { key: "c", header: "Community", render: (r: any) => r.community },
                { key: "ct", header: "Care type", render: (r: any) => r.careType },
                { key: "u", header: "Units", align: "right", render: (r: any) => r.units },
                { key: "o", header: "Occupied", align: "right", render: (r: any) => r.occupied },
                {
                  key: "p",
                  header: "Occupancy",
                  align: "right",
                  render: (r: any) => (r.units ? `${((r.occupied / r.units) * 100).toFixed(1)}%` : "—"),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
