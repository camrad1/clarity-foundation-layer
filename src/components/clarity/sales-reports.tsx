import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHART_TOKENS,
  ChartCard,
  GroupedBarChart,
  HorizontalBarChart,
  MetricTrendChart,
} from "@/components/clarity/charts";
import { SeriesToggleChips, useSeriesVisibility } from "@/components/clarity/series-toggle";
import {
  categoryColor,
  downloadCsv,
  pivotByBucket,
  rankCategories,
  seriesKey,
  useLostLeads,
  useMoveInsByLeadSource,
  useMoveOutReasons,
  useNewInquiriesTrend,
  useOccupancyHistory,
} from "@/lib/wh/reports";
import { useOccupancyTrend } from "@/lib/wh/snapshots";
import { occupancyAxis, visibleValues } from "@/lib/charts/occupancy-axis";

/**
 * WelcomeHome standard operational reports rebuilt on ClarityIQ's canonical
 * data.
 *
 * Each tab follows the same shape: one bounded server-side aggregate feeds a
 * visual trend layer first and the detailed table second. Charts answer "what
 * is changing"; the table underneath answers "exactly what are the numbers".
 * No KPI is recomputed here — the components only reshape aggregates for
 * display.
 */

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const monthLabel = (iso: string) => MONTH_FMT.format(asDate(iso));
const weekLabel = (iso: string) => `Wk ${DAY_FMT.format(asDate(iso))}`;

const num = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());
const pct1 = (n: number | null | undefined) => (n == null ? "—" : `${(Number(n) * 100).toFixed(1)}%`);
const share = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—");

/** Section shell: heading, optional note, export actions, then content. */
function ReportSection({
  title,
  description,
  note,
  onExport,
  children,
}: {
  title: string;
  description: string;
  note?: React.ReactNode;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-brand">{title}</h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          {onExport ? (
            <Button variant="outline" size="sm" onClick={onExport}>
              Export CSV
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      </div>
      {note ? (
        <p className="rounded-md border border-border bg-brand-soft/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/** Month-column grid used by the transposed reports. Numeric cells centre. */
function MonthGrid({
  columns,
  rows,
  firstHeader,
}: {
  columns: string[];
  rows: { label: string; muted?: boolean; values: (string | number)[] }[];
  firstHeader: string;
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="thead-brand">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
              {firstHeader}
            </th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border odd:bg-brand-soft/60">
              <td className={`px-3 py-2 whitespace-nowrap ${r.muted ? "text-muted-foreground" : "font-medium"}`}>
                {r.label}
              </td>
              {r.values.map((v, i) => (
                <td key={i} className="px-3 py-2 text-center tabular-nums">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TabProps = {
  organizationId: string | null;
  communityIds: string[];
  end: string;
  months?: number;
};

/** Occupancy tabs are driven by the global date filter, not a fixed window. */
type RangeTabProps = {
  organizationId: string | null;
  communityIds: string[];
  start: string;
  end: string;
};

/* ============================================================ Occupancy */

const tipPct = (v: any) => (v == null || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`);
const tipNum = (v: any) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString());

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </p>
  );
}



export function OccupancyHistoryTab({ organizationId, communityIds, start, end }: RangeTabProps) {
  const q = useOccupancyHistory(organizationId, communityIds, start.slice(0, 10), end.slice(0, 10));

  const rows = q.data ?? [];

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: monthLabel(r.month),
        ending_pct: r.ending_pct == null ? null : Number((Number(r.ending_pct) * 100).toFixed(1)),
        beginning_pct: r.beginning_pct == null ? null : Number((Number(r.beginning_pct) * 100).toFixed(1)),
        budget_pct: r.budget_pct == null ? null : Number((Number(r.budget_pct) * 100).toFixed(1)),
        beginning_occupied: r.beginning_occupied,
        ending_occupied: r.ending_occupied,
      })),
    [rows],
  );

  const pctSeries = [
    { key: "ending_pct", label: "Ending occupancy %", color: CHART_TOKENS.primary },
    { key: "beginning_pct", label: "Beginning occupancy %", color: CHART_TOKENS.secondary },
    { key: "budget_pct", label: "Budget occupancy %", color: CHART_TOKENS.tertiary, dashed: true },
  ];
  const pctVis = useSeriesVisibility(
    "clarity.occhistory.pct",
    pctSeries.map((s) => s.key),
    ["ending_pct", "budget_pct"],
  );

  const unitSeries = [
    { key: "beginning_occupied", label: "Beginning occupancy #", color: CHART_TOKENS.secondary },
    { key: "ending_occupied", label: "Ending occupancy #", color: CHART_TOKENS.primary },
  ];
  const unitVis = useSeriesVisibility(
    "clarity.occhistory.units",
    unitSeries.map((s) => s.key),
    ["ending_occupied"],
  );

  const hasHistory = rows.some((r) => r.ending_pct != null || r.beginning_pct != null);
  const columns = rows.map((r) => monthLabel(r.month));

  // Axes follow the enabled series only, so toggling a series rescales immediately.
  const pctAxis = occupancyAxis(visibleValues(chartData, pctVis.visible), "percent");
  const unitAxis = occupancyAxis(visibleValues(chartData, unitVis.visible), "count");


  const exportCsv = () =>
    downloadCsv("clarityiq-occupancy-history.csv", [
      ["Metric", ...columns],
      ["Beginning occupancy #", ...rows.map((r) => r.beginning_occupied ?? "")],
      ["Move-ins", ...rows.map((r) => r.move_ins)],
      ["Move-outs", ...rows.map((r) => r.move_outs)],
      ["Net MI/MO", ...rows.map((r) => r.net_move_ins)],
      ["Ending occupancy #", ...rows.map((r) => r.ending_occupied ?? "")],
      ["Beginning occupancy %", ...rows.map((r) => (r.beginning_pct == null ? "" : pct1(r.beginning_pct)))],
      ["Ending occupancy %", ...rows.map((r) => (r.ending_pct == null ? "" : pct1(r.ending_pct)))],
    ]);

  return (
    <ReportSection
      title="Occupancy history"
      description="Month-over-month beginning and ending occupancy alongside the validated move-in and move-out counts for the same month."
      note={
        hasHistory ? (
          <>
            Historical occupancy before ClarityIQ nightly snapshots is sourced from official imported
            occupancy history. Beginning is the first stored day of the month and ending is the last —
            daily values are never averaged, and periods with no stored record show —.
          </>
        ) : (
          <>
            No month in the selected range has stored occupancy history, so those rows show —. History
            comes from nightly snapshots and from the official day-over-day workbooks imported in
            Admin → Occupancy History Import. Move-ins and move-outs still use validated period-event logic.
          </>
        )
      }
      onExport={exportCsv}
    >
      <ChartCard
        title="Occupancy over time"
        description="Historical occupancy percentage over time using official imported history and ClarityIQ nightly snapshots, with the configured budget line where one exists."
        loading={q.isLoading}
        empty={!hasHistory ? "No stored occupancy history for the selected period." : undefined}
        actions={
          <SeriesToggleChips series={pctSeries} visible={pctVis.visible} onToggle={pctVis.toggle} />
        }
      >
        <MetricTrendChart
          data={chartData}
          series={pctSeries.filter((s) => pctVis.visible.includes(s.key))}
          valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
          yDomain={pctAxis.domain}
          yTicks={pctAxis.ticks}
        />
      </ChartCard>

      <ChartCard
        title="Occupied units over time"
        description="Occupied unit counts from the same stored historical records."
        loading={q.isLoading}
        empty={!hasHistory ? "No stored occupied unit counts for the selected period." : undefined}
        height={240}
        actions={
          <SeriesToggleChips series={unitSeries} visible={unitVis.visible} onToggle={unitVis.toggle} />
        }
      >
        <MetricTrendChart
          data={chartData}
          series={unitSeries.filter((s) => unitVis.visible.includes(s.key))}
          yDomain={unitAxis.domain}
          yTicks={unitAxis.ticks}
        />

      </ChartCard>

      <OccupancyDailyDetail organizationId={organizationId} communityIds={communityIds} start={start} end={end} />




      <MonthGrid
        firstHeader="Metric"
        columns={columns}
        rows={[
          { label: "Beginning occupancy #", values: rows.map((r) => num(r.beginning_occupied)) },
          { label: "Move-ins", values: rows.map((r) => num(r.move_ins)) },
          { label: "Move-outs", values: rows.map((r) => num(r.move_outs)) },
          { label: "Net MI/MO", values: rows.map((r) => num(r.net_move_ins)) },
          { label: "Ending occupancy #", values: rows.map((r) => num(r.ending_occupied)) },
          { label: "Beginning occupancy %", muted: true, values: rows.map((r) => pct1(r.beginning_pct)) },
          { label: "Ending occupancy %", muted: true, values: rows.map((r) => pct1(r.ending_pct)) },
        ]}
      />
    </ReportSection>
  );
}

/** Exact stored values for the hovered day or week. */
function OccupancyDetailTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{p.label}</p>
      <TipRow label="Occupancy" value={tipPct(p.occupancy_pct)} />
      <TipRow label="Occupied units" value={tipNum(p.occupied)} />
    </div>
  );
}

/**
 * Daily / weekly occupancy detail, read from stored history only and bounded by
 * the global date filter. Nightly snapshots take precedence; the official
 * imported day-over-day history fills dates before snapshots began. Gaps stay gaps.
 */

function OccupancyDailyDetail({ organizationId, communityIds, start, end }: RangeTabProps) {
  const [grain, setGrain] = useState<"daily" | "weekly">("weekly");
  // Percentages and unit counts are incompatible units, so they never share one axis.
  const [metric, setMetric] = useState<"pct" | "units">("pct");
  const q = useOccupancyTrend(organizationId, communityIds, start.slice(0, 10), end.slice(0, 10), grain);

  const points = (q.data ?? []).map((p) => ({
    label: grain === "daily" ? DAY_FMT.format(asDate(p.period_start)) : weekLabel(p.period_start),
    occupancy_pct: p.occupancy_pct == null ? null : Number((Number(p.occupancy_pct) * 100).toFixed(1)),
    occupied: p.occupied_units,
  }));
  const backfillPeriods = (q.data ?? []).filter((p) => p.backfill_communities > 0).length;
  const snapshotPeriods = (q.data ?? []).filter((p) => p.snapshot_communities > 0).length;

  const percent = metric === "pct";
  const series = percent
    ? [{ key: "occupancy_pct", label: "Occupancy %", color: CHART_TOKENS.primary }]
    : [{ key: "occupied", label: "Occupied units", color: CHART_TOKENS.secondary }];
  const axis = occupancyAxis(
    visibleValues(points, series.map((s) => s.key)),
    percent ? "percent" : "count",
  );

  return (
    <ChartCard
      title={`Occupancy detail — ${grain === "daily" ? "daily" : "weekly"}`}
      description={
        points.length
          ? `${points.length} stored ${grain === "daily" ? "days" : "weeks"} · ${snapshotPeriods} with nightly snapshots · ${backfillPeriods} from official imported history`
          : "Stored daily history required — nothing is reconstructed."
      }
      loading={q.isLoading}
      empty={points.length === 0 ? "No stored daily occupancy history for this selection." : undefined}
      height={240}
      actions={
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1">
            {(["pct", "units"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={metric === m ? "default" : "outline"}
                onClick={() => setMetric(m)}
              >
                {m === "pct" ? "Occupancy %" : "Units"}
              </Button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["weekly", "daily"] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={grain === g ? "default" : "outline"}
                onClick={() => setGrain(g)}
              >
                {g === "weekly" ? "Weekly" : "Daily"}
              </Button>
            ))}
          </div>
        </div>
      }
    >
      <MetricTrendChart
        data={points}
        series={series}
        yDomain={axis.domain}
        yTicks={axis.ticks}
        {...(percent ? { valueFormatter: (v: number) => `${Number(v).toFixed(1)}%` } : {})}
        tooltip={<OccupancyDetailTooltip />}
      />
    </ChartCard>

  );
}



/* ================================================== Move-ins by source */

export function MoveInsByLeadSourceTab({ organizationId, communityIds, end, months = 12 }: TabProps) {
  const q = useMoveInsByLeadSource(organizationId, communityIds, end, months);
  const rows = q.data ?? [];

  const buckets = useMemo(
    () => [...new Set(rows.map((r) => r.month.slice(0, 10)))].sort(),
    [rows],
  );
  const ranked = useMemo(() => rankCategories(rows, "lead_source_label", "move_ins"), [rows]);
  const total = ranked.reduce((a, b) => a + b.total, 0);

  const series = ranked.map((r, i) => ({
    key: seriesKey(r.label),
    label: r.label,
    color: categoryColor(i),
  }));
  const vis = useSeriesVisibility(
    "clarity.moveins.sources",
    series.map((s) => s.key),
    series.slice(0, 6).map((s) => s.key),
  );

  const pivot = useMemo(
    () =>
      pivotByBucket(rows, "month", "lead_source_label", "move_ins", buckets).map((r) => ({
        ...r,
        label: monthLabel(r["bucket"] as string),
      })),
    [rows, buckets],
  );

  const perSourceMonth = (label: string, bucket: string) =>
    rows.find((r) => r.lead_source_label === label && r.month.slice(0, 10) === bucket)?.move_ins ?? 0;

  const exportCsv = () =>
    downloadCsv("clarityiq-move-ins-by-lead-source.csv", [
      ["Lead source", ...buckets.map(monthLabel), "Total", "% of move-ins"],
      ...ranked.map((r) => [
        r.label,
        ...buckets.map((b) => perSourceMonth(r.label, b)),
        r.total,
        share(r.total, total),
      ]),
    ]);

  return (
    <ReportSection
      title="Move-ins by lead source"
      description="Validated move-ins for each month attributed to the primary lead source recorded on the prospect record in WelcomeHome. Share is the percentage of move-ins in the window, not a return-on-investment measure."
      note="Lead source describes where the inquiry originated. It does not imply spend, causation or attribution across channels."
      onExport={exportCsv}
    >
      <ChartCard
        title="Move-ins by lead source over time"
        description="Stacked monthly move-ins. Toggle sources to isolate the ones you care about."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No move-ins with a lead source in this window." : undefined}
        actions={<SeriesToggleChips series={series} visible={vis.visible} onToggle={vis.toggle} />}
      >
        <GroupedBarChart
          data={pivot}
          bars={series.filter((s) => vis.visible.includes(s.key))}
          stacked
        />
      </ChartCard>

      <ChartCard
        title="Top lead sources"
        description="Total move-ins per lead source across the whole window."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No move-ins with a lead source in this window." : undefined}
        height={Math.max(200, Math.min(ranked.length, 10) * 30 + 50)}
      >
        <HorizontalBarChart
          data={ranked.slice(0, 10).map((r) => ({ label: r.label, value: r.total }))}
          valueLabel="Move-ins"
        />
      </ChartCard>

      <MonthGrid
        firstHeader="Lead source"
        columns={[...buckets.map(monthLabel), "Total MI", "MI %"]}
        rows={ranked.map((r) => ({
          label: r.label,
          values: [...buckets.map((b) => perSourceMonth(r.label, b)), r.total, share(r.total, total)],
        }))}
      />
    </ReportSection>
  );
}

/* ==================================================== Move-out reasons */

export function MoveOutReasonsTab({ organizationId, communityIds, end, months = 12 }: TabProps) {
  const q = useMoveOutReasons(organizationId, communityIds, end, months);
  const rows = q.data ?? [];

  const buckets = useMemo(() => [...new Set(rows.map((r) => r.month.slice(0, 10)))].sort(), [rows]);
  const ranked = useMemo(() => rankCategories(rows, "reason_label", "move_outs"), [rows]);
  const total = ranked.reduce((a, b) => a + b.total, 0);

  // Weighted average length of stay per reason, from the server-side averages
  // and their sample sizes. Only contracts carrying both a move-in and a
  // move-out date contribute.
  const losByReason = useMemo(() => {
    const acc = new Map<string, { days: number; n: number }>();
    for (const r of rows) {
      if (r.los_days == null || !r.los_sample) continue;
      const cur = acc.get(r.reason_label) ?? { days: 0, n: 0 };
      cur.days += Number(r.los_days) * r.los_sample;
      cur.n += r.los_sample;
      acc.set(r.reason_label, cur);
    }
    return acc;
  }, [rows]);

  const series = ranked.map((r, i) => ({ key: seriesKey(r.label), label: r.label, color: categoryColor(i) }));
  const vis = useSeriesVisibility(
    "clarity.moveouts.reasons",
    series.map((s) => s.key),
    series.slice(0, 6).map((s) => s.key),
  );

  const pivot = useMemo(
    () =>
      pivotByBucket(rows, "month", "reason_label", "move_outs", buckets).map((r) => ({
        ...r,
        label: monthLabel(r["bucket"] as string),
      })),
    [rows, buckets],
  );

  const losText = (label: string) => {
    const l = losByReason.get(label);
    if (!l || !l.n) return "—";
    return `${Math.round(l.days / l.n).toLocaleString()} d`;
  };

  const exportCsv = () =>
    downloadCsv("clarityiq-move-out-reasons.csv", [
      ["Reason", "Avg length of stay (days)", "Move-outs", "% of move-outs"],
      ...ranked.map((r) => [r.label, losText(r.label), r.total, share(r.total, total)]),
    ]);

  return (
    <ReportSection
      title="Move-out reasons"
      description="Validated move-outs grouped by the move-out reason stored on the WelcomeHome housing contract."
      note="Length of stay is the elapsed days between the same move-in and move-out date fields the validated KPIs use, averaged only over contracts that carry both dates — contracts missing a move-in date are excluded from the average, never estimated. Contracts with no reason recorded in WelcomeHome appear as Not recorded."
      onExport={exportCsv}
    >
      <ChartCard
        title="Move-outs by reason"
        description="Total move-outs per reason across the whole window."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No move-outs in this window." : undefined}
        height={Math.max(200, Math.min(ranked.length, 12) * 28 + 50)}
      >
        <HorizontalBarChart
          data={ranked.slice(0, 12).map((r) => ({ label: r.label, value: r.total }))}
          valueLabel="Move-outs"
          labelWidth={170}
        />
      </ChartCard>

      <ChartCard
        title="Move-out reason trend"
        description="Monthly counts by reason. The highest-volume reasons are shown by default; enable others as needed."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No move-outs in this window." : undefined}
        actions={<SeriesToggleChips series={series} visible={vis.visible} onToggle={vis.toggle} />}
      >
        <GroupedBarChart data={pivot} bars={series.filter((s) => vis.visible.includes(s.key))} stacked />
      </ChartCard>

      <MonthGrid
        firstHeader="Reason"
        columns={["Avg LOS", "Move-outs", "%"]}
        rows={ranked.map((r) => ({
          label: r.label,
          values: [losText(r.label), r.total, share(r.total, total)],
        }))}
      />
    </ReportSection>
  );
}

/* ======================================================= New inquiries */

export function NewInquiriesTab({ organizationId, communityIds, end }: TabProps) {
  const [grain, setGrain] = useState<"month" | "week">("month");
  const periods = grain === "month" ? 12 : 13;
  const q = useNewInquiriesTrend(organizationId, communityIds, end, grain, periods);
  const rows = q.data ?? [];

  const data = rows.map((r) => ({
    label: grain === "month" ? monthLabel(r.bucket) : weekLabel(r.bucket),
    inquiries: r.inquiries,
  }));

  const exportCsv = () =>
    downloadCsv(`clarityiq-new-inquiries-${grain}.csv`, [
      [grain === "month" ? "Month" : "Week starting", "New inquiries"],
      ...rows.map((r) => [r.bucket.slice(0, 10), r.inquiries]),
    ]);

  const total = rows.reduce((a, b) => a + b.inquiries, 0);

  return (
    <ReportSection
      title="New inquiries"
      description="Countable new prospects per period using the validated ClarityIQ wh.new_inquiries definition, bucketed server-side on community-local dates."
      note="This report reproduces the WelcomeHome report concept, not its internal logic: counts follow ClarityIQ's validated inquiry definition and the organization's configured merged/discarded exclusions."
      onExport={exportCsv}
    >
      <ChartCard
        title="New inquiries over time"
        description="Exact counts appear in the tooltip."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No inquiries in this window." : undefined}
        actions={
          <div className="flex gap-1.5 print:hidden">
            {(["month", "week"] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={grain === g ? "default" : "outline"}
                onClick={() => setGrain(g)}
              >
                {g === "month" ? "Monthly" : "Weekly"}
              </Button>
            ))}
          </div>
        }
      >
        <MetricTrendChart
          data={data}
          series={[{ key: "inquiries", label: "New inquiries", color: CHART_TOKENS.primary }]}
        />
      </ChartCard>

      <MonthGrid
        firstHeader="Metric"
        columns={data.map((d) => d.label)}
        rows={[
          { label: "New inquiries", values: data.map((d) => d.inquiries) },
          {
            label: "Change vs prior",
            muted: true,
            values: data.map((d, i) =>
              i === 0 ? "—" : `${d.inquiries - data[i - 1]!.inquiries > 0 ? "+" : ""}${d.inquiries - data[i - 1]!.inquiries}`,
            ),
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">Total for the window: {total.toLocaleString()}</p>
    </ReportSection>
  );
}

/* =========================================================== Lost leads */

export function LostLeadsTab({ organizationId, communityIds, end, months = 12 }: TabProps) {
  const q = useLostLeads(organizationId, communityIds, end, months);
  const rows = q.data ?? [];

  const buckets = useMemo(() => [...new Set(rows.map((r) => r.month.slice(0, 10)))].sort(), [rows]);
  const ranked = useMemo(() => rankCategories(rows, "reason_label", "lost_leads"), [rows]);
  const total = ranked.reduce((a, b) => a + b.total, 0);

  const totalsByMonth = useMemo(
    () =>
      buckets.map((b) => ({
        label: monthLabel(b),
        lost: rows.filter((r) => r.month.slice(0, 10) === b).reduce((a, r) => a + r.lost_leads, 0),
      })),
    [rows, buckets],
  );

  const series = ranked.map((r, i) => ({ key: seriesKey(r.label), label: r.label, color: categoryColor(i) }));
  const vis = useSeriesVisibility(
    "clarity.lostleads.reasons",
    series.map((s) => s.key),
    series.slice(0, 6).map((s) => s.key),
  );

  const pivot = useMemo(
    () =>
      pivotByBucket(rows, "month", "reason_label", "lost_leads", buckets).map((r) => ({
        ...r,
        label: monthLabel(r["bucket"] as string),
      })),
    [rows, buckets],
  );

  const exportCsv = () =>
    downloadCsv("clarityiq-lost-leads.csv", [
      ["Close reason", "Lost leads", "% of total"],
      ...ranked.map((r) => [r.label, r.total, share(r.total, total)]),
    ]);

  return (
    <ReportSection
      title="Lost leads"
      description="Prospects closed in each month grouped by the structured WelcomeHome close reason, using community-local close dates."
      note="Close reason detail is not available: the WelcomeHome dataset ClarityIQ ingests carries a single structured close reason per prospect with no detail field, so no detail column is shown rather than inventing one. Reason labels come straight from the source lookup values."
      onExport={exportCsv}
    >
      <ChartCard
        title="Lost leads over time"
        description="All closed prospects with a recorded close reason, by month."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No closed prospects in this window." : undefined}
        height={240}
      >
        <MetricTrendChart
          data={totalsByMonth}
          series={[{ key: "lost", label: "Lost leads", color: CHART_TOKENS.primary }]}
        />
      </ChartCard>

      <ChartCard
        title="Lost leads by reason"
        description="Total per close reason across the whole window."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No closed prospects in this window." : undefined}
        height={Math.max(200, Math.min(ranked.length, 12) * 28 + 50)}
      >
        <HorizontalBarChart
          data={ranked.slice(0, 12).map((r) => ({ label: r.label, value: r.total }))}
          valueLabel="Lost leads"
          labelWidth={200}
        />
      </ChartCard>

      <ChartCard
        title="Lost leads by reason over time"
        description="Monthly counts per close reason. Toggle reasons to compare specific loss drivers."
        loading={q.isLoading}
        empty={rows.length === 0 ? "No closed prospects in this window." : undefined}
        actions={<SeriesToggleChips series={series} visible={vis.visible} onToggle={vis.toggle} />}
      >
        <GroupedBarChart
          data={pivot}
          bars={series.filter((s) => vis.visible.includes(s.key))}
          stacked
          totalLabel="Total lost leads"
        />
      </ChartCard>

      <MonthGrid
        firstHeader="Close reason"
        columns={["Lost leads", "% of total"]}
        rows={ranked.map((r) => ({ label: r.label, values: [r.total, share(r.total, total)] }))}
      />
    </ReportSection>
  );
}
