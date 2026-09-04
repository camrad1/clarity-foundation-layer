import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { CHART_TOKENS, ChartCard, MetricTrendChart, ProgressGauge } from "@/components/clarity/charts";
import { occupancyAxis } from "@/lib/charts/occupancy-axis";
import { useWhContext } from "@/lib/wh/use-wh";
import { useOccupancyTrend } from "@/lib/wh/snapshots";
import {
  effectiveBudget,
  resolveBudget,
  useOccupancyWithBudget,
  type CommunityOccupancy,
} from "@/lib/wh/occupancy";

export const Route = createFileRoute("/_authenticated/occupancy")({
  head: () => ({
    meta: [
      { title: "Occupancy Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content: "Current occupancy, vacancy, notices and budget variance by community and care type.",
      },
      { property: "og:title", content: "Occupancy Intelligence — ONELIFE Marketing Performance Hub" },
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
              as-of-date occupancy is shown separately below, read from immutable daily snapshots.
            </p>
          </section>

          <OccupancyHistory
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            start={ctx.dateRange.start.slice(0, 10)}
            end={ctx.dateRange.end.slice(0, 10)}
          />

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
    <div className="rounded-lg border border-brand-border bg-brand-soft p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-brand">{value}</p>
    </div>
  );
}

type Grain = "daily" | "weekly" | "monthly";

function daysBetween(start: string, end: string) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

function defaultGrain(days: number): Grain {
  if (days <= 31) return "daily";
  if (days <= 120) return "weekly";
  return "monthly";
}

/** Rounded axis bounds derived from the plotted values (shared occupancy helper). */
function niceDomain(values: number[], percent: boolean) {
  return occupancyAxis(values, percent ? "percent" : "count");
}


function OccupancyTooltip({ active, payload, percent, periodNoun }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const num = (v: any) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v));
  const pctv = (v: any) => (v == null || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`);
  const variance =
    p.pct != null && p.budgetPct != null ? `${(p.pct - p.budgetPct >= 0 ? "+" : "")}${(p.pct - p.budgetPct).toFixed(1)} pts` : "—";
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{p.full}</p>
      <p className="mb-1 text-[11px] text-muted-foreground">{periodNoun}</p>
      <Row label="Occupancy %" value={pctv(p.pct)} />
      <Row label="Occupied capacity" value={String(num(p.occupied))} />
      <Row label="Census capacity" value={String(num(p.census))} />
      <Row label="Budget %" value={pctv(p.budgetPct)} />
      <Row label="Variance to budget" value={variance} />
      {percent ? null : <Row label="Budget capacity" value={String(num(p.budget))} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center gap-4 text-muted-foreground">
      <span>{label}</span>
      <span className="ml-auto tabular-nums text-foreground">{value}</span>
    </p>
  );
}

function Toggle({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (k: any) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-md border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            className={
              "rounded px-2 py-0.5 text-xs font-medium transition-colors " +
              (value === o.key
                ? "bg-brand text-brand-foreground"
                : o.disabled
                  ? "text-muted-foreground/40"
                  : "text-muted-foreground hover:text-foreground")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Historical occupancy — read ONLY from immutable daily snapshots or the
 * official imported daily history, following canonical precedence. Days with
 * no record simply do not appear; nothing is interpolated or reconstructed
 * from current-state rows. Weekly/monthly views use the canonical end-of-period
 * value, never an average of daily percentages.
 */
function OccupancyHistory({
  organizationId,
  communityIds,
  start,
  end,
}: {
  organizationId: string | null;
  communityIds: string[];
  start: string;
  end: string;
}) {
  const days = daysBetween(start, end);
  const auto = defaultGrain(days);
  const [grainOverride, setGrainOverride] = useState<Grain | null>(null);
  const [metric, setMetric] = useState<"pct" | "units">("pct");
  const grain: Grain = grainOverride ?? auto;
  const trend = useOccupancyTrend(organizationId, communityIds, start, end, grain);

  const points = (trend.data ?? []).map((p) => {
    const pct = p.occupancy_pct == null ? null : Number(p.occupancy_pct) * 100;
    // wh_occupancy_trend returns occupancy_pct as a fraction and budget_pct already on a 0-100 scale.
    const budgetPct = p.budget_pct == null ? null : Number(p.budget_pct);
    return {
      label: grain === "monthly" ? p.snapshot_date.slice(0, 7) : p.snapshot_date.slice(5),
      full: p.snapshot_date,
      pct,
      budgetPct,
      occupied: p.occupied_units,
      census: p.census_units,
      budget: p.budget_units ?? null,
    };
  });

  const percent = metric === "pct";
  const values = points.flatMap((p) =>
    percent ? [p.pct, p.budgetPct] : [p.occupied, p.census, p.budget],
  );
  const axis = niceDomain(values.filter((v): v is number => v != null), percent);
  const periodNoun =
    grain === "daily"
      ? "Daily snapshot"
      : grain === "weekly"
        ? "Ending occupancy for this week"
        : "Ending occupancy for this month";

  const series = percent
    ? [
        { key: "pct", label: "Occupancy %", color: CHART_TOKENS.primary },
        { key: "budgetPct", label: "Budget %", color: CHART_TOKENS.secondary, dashed: true },
      ]
    : [
        { key: "occupied", label: "Occupied capacity", color: CHART_TOKENS.primary },
        { key: "census", label: "Census capacity", color: CHART_TOKENS.muted },
        { key: "budget", label: "Budget capacity", color: CHART_TOKENS.secondary, dashed: true },
      ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Occupancy over time</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {start} – {end}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Toggle
          label="View by"
          value={grain}
          onChange={setGrainOverride}
          options={[
            { key: "daily", label: "Daily" },
            { key: "weekly", label: "Weekly", disabled: days < 14 },
            { key: "monthly", label: "Monthly", disabled: days < 60 },
          ]}
        />
        <Toggle
          label="View"
          value={metric}
          onChange={setMetric}
          options={[
            { key: "pct", label: "Occupancy %" },
            { key: "units", label: "Units" },
          ]}
        />
      </div>
      {trend.isLoading ? (
        <div className="panel h-64 animate-pulse" />
      ) : points.length === 0 ? (
        <EmptyState
          title="No occupancy history for this period"
          description="Historical occupancy comes from immutable nightly snapshots or the official imported daily history. Gaps are never interpolated or reconstructed from today's data."
        />
      ) : (
        <ChartCard
          title={percent ? "Occupancy % vs budget" : "Occupied vs census capacity"}
          description={`${points.length} ${grain} point${points.length === 1 ? "" : "s"} · last ${points[points.length - 1]?.full}${
            grain === "daily" ? "" : " · end-of-period values"
          }`}
          height={300}
        >
          <MetricTrendChart
            data={points}
            series={series}
            yDomain={axis.domain}
            yTicks={axis.ticks}
            {...(percent ? { valueFormatter: (v: number) => `${Number(v).toFixed(1)}%` } : {})}
            tooltip={<OccupancyTooltip percent={percent} periodNoun={periodNoun} />}
          />
        </ChartCard>
      )}
    </section>
  );
}

