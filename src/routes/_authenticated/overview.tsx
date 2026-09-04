import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/clarity/page-header";
import { EmptyState } from "@/components/clarity/empty-state";
import { DataTable, type Column } from "@/components/clarity/data-table";
import { useWhContext } from "@/lib/wh/use-wh";
import {
  effectiveBudget,
  resolveBudget,
  useOccupancyWithBudget,
  type CommunityOccupancy,
} from "@/lib/wh/occupancy";
import { useOccupancyTrend, useSnapshotHealth } from "@/lib/wh/snapshots";
import { useWhSalesSummary } from "@/lib/wh/summary";
import { useFlashReport, useFlashReportsByCommunity } from "@/lib/flash/queries";
import { currentFlashWeek, monthStart, formatMonth, todayISO } from "@/lib/flash/period";
import { useDailyTotals, useGrainImports, selectImportForPeriod, usePageReport } from "@/lib/gsc/queries";
import { comparisonModeLabel, formatPeriodLabel, formatRangeLabel } from "@/lib/date-ranges";
import { useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Executive command center: current occupancy, month-to-date move-ins, funnel pulse, the communities that need attention and what changed.",
      },
      { property: "og:title", content: "Overview — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Where are we now, what changed, and what needs attention.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

const JOURNEY = [
  { label: "Visibility", note: "Search Console" },
  { label: "Traffic", note: "Website" },
  { label: "Conversations", note: "Further" },
  { label: "Leads", note: "WelcomeHome" },
  { label: "Tours", note: "WelcomeHome" },
  { label: "Deposits", note: "WelcomeHome" },
  { label: "Move-Ins", note: "WelcomeHome" },
  { label: "Occupancy", note: "Snapshots" },
];

const na = "—";

function pct1(v: number | null | undefined) {
  return v == null ? na : `${(Number(v) * 100).toFixed(1)}%`;
}
function pts1(v: number | null | undefined) {
  if (v == null) return na;
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)} pts`;
}
function num(v: number | null | undefined) {
  return v == null ? na : Number(v).toLocaleString();
}
function signed(v: number | null | undefined) {
  if (v == null) return na;
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;
}
function deltaPct(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || prior == null) return null;
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

// ---------------------------------------------------------------------------
// Presentation primitives
// ---------------------------------------------------------------------------

function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

function KpiCard({
  label,
  value,
  context,
  tone = "neutral",
  to,
  badge,
}: {
  label: string;
  value: string;
  context?: string;
  tone?: "neutral" | "up" | "down";
  to?: string;
  badge?: string;
}) {
  const body = (
    <div className="kpi-card h-full space-y-1.5 p-5 transition-colors hover:border-brand/40">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {badge ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "font-display text-2xl font-semibold tracking-tight",
          tone === "up" && "text-success",
          tone === "down" && "text-destructive",
          tone === "neutral" && "text-brand",
        )}
      >
        {value}
      </p>
      {context ? <p className="text-xs leading-snug text-muted-foreground">{context}</p> : null}
      {to ? (
        <p className="inline-flex items-center gap-1 pt-0.5 text-[11px] font-medium text-brand">
          View detail <ArrowUpRight className="size-3" />
        </p>
      ) : null}
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

// ---------------------------------------------------------------------------

function Overview() {
  const ctx = useWhContext();
  const { comparisonMode, comparisonRange, dateRange, setCommunityScope } = useAppState();
  const navigate = useNavigate();

  const start = ctx.dateRange.start.slice(0, 10);
  const end = ctx.dateRange.end.slice(0, 10);
  const today = todayISO();
  const week = currentFlashWeek(today);
  const month = monthStart(today);

  // Canonical sources — identical to Occupancy Intelligence, Flash Report,
  // Sales Intelligence and Marketing Intelligence. No KPI is redefined here.
  const { occupancy, budgetRows } = useOccupancyWithBudget(ctx.organizationId, ctx.communityIds);
  const flash = useFlashReport(ctx.organizationId, ctx.communityIds, week.start, week.end, month);
  const sales = useWhSalesSummary(ctx.organizationId, ctx.communityIds, start, end);
  const priorSales = useWhSalesSummary(
    ctx.organizationId,
    ctx.communityIds,
    comparisonRange?.start ?? start,
    comparisonRange?.end ?? end,
  );
  const trend = useOccupancyTrend(ctx.organizationId, ctx.communityIds, start, end, "daily");
  const snapshotHealth = useSnapshotHealth(ctx.organizationId, ctx.communityIds);

  const gsc = useDailyTotals(ctx.organizationId, { start, end });
  const priorGsc = useDailyTotals(ctx.organizationId, comparisonRange);

  const rows = occupancy.data?.communities ?? [];
  const totals = occupancy.data?.totals;
  const monthPeriod = flash.data?.month ?? null;

  // Portfolio budget: the same per-community resolution Occupancy Intelligence
  // uses, summed over the selection.
  const perCommunity = useMemo(
    () =>
      rows.map((r) => {
        const budget = resolveBudget(effectiveBudget(budgetRows, r.id), r.census_units, r.occupied_units);
        return { row: r, budget };
      }),
    [rows, budgetRows],
  );

  const budgetUnits = perCommunity.reduce<number | null>(
    (acc, c) => (c.budget.units == null ? acc : (acc ?? 0) + c.budget.units),
    null,
  );
  const actualPct = totals?.occupancyPct == null ? null : Number(totals.occupancyPct);
  const budgetPct = budgetUnits != null && totals?.censusUnits ? budgetUnits / totals.censusUnits : null;
  const variancePoints = actualPct != null && budgetPct != null ? (actualPct - budgetPct) * 100 : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ONELIFE Marketing Performance Hub"
        title="Performance intelligence, end to end"
        description="Marketing, CRM, sales and occupancy in one place — so you can see where the portfolio stands right now, what changed, and where leadership should pay attention."
      />

      <section className="space-y-3">
        <SectionHeading title="The performance journey" />
        <div className="panel overflow-x-auto p-6">
          <ol className="flex min-w-max items-stretch gap-2">
            {JOURNEY.map((step, i) => (
              <li key={step.label} className="flex items-center gap-2">
                <div className="min-w-[9.5rem] rounded-md border border-border bg-background px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{step.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.note}</p>
                </div>
                {i < JOURNEY.length - 1 ? (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 — Portfolio Snapshot ------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading
          title="Portfolio snapshot"
          hint={`Occupancy and move activity are current state as of ${occupancy.data?.asOf ?? "today"} — not affected by the selected date range.`}
        />
        {occupancy.isLoading || flash.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="kpi-card h-32 animate-pulse" />
            ))}
          </div>
        ) : !totals || totals.censusUnits === 0 ? (
          <EmptyState
            title="No occupancy data for this selection"
            description="Sync the WelcomeHome unit and housing-contract datasets for the selected communities. Nothing is estimated to fill the gap."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Current occupancy"
              value={pct1(actualPct)}
              context={`${num(totals.occupiedUnits)} of ${num(totals.censusUnits)} census-eligible units`}
              to="/occupancy"
            />
            <KpiCard
              label="Occupancy vs budget"
              value={pts1(variancePoints)}
              tone={variancePoints == null ? "neutral" : variancePoints >= 0 ? "up" : "down"}
              context={
                budgetPct == null
                  ? "No occupancy budget configured for this selection"
                  : `Budget ${pct1(budgetPct)} · ${signed(totals.occupiedUnits - (budgetUnits ?? 0))} units`
              }
              to="/occupancy"
            />
            <KpiCard
              label="Projected month-end occupancy"
              value={
                monthPeriod?.projectedOccupancyPct == null
                  ? na
                  : `${Number(monthPeriod.projectedOccupancyPct).toFixed(1)}%`
              }
              badge={formatMonth(month)}
              context={
                monthPeriod?.projectedOccupiedUnits == null
                  ? "Projection needs current occupancy plus scheduled moves"
                  : `${num(monthPeriod.projectedOccupiedUnits)} of ${num(monthPeriod.projectedCensusUnits)} units after scheduled move-ins and move-outs`
              }
              to="/flash"
            />
            <KpiCard
              label="Move-ins month to date"
              value={num(monthPeriod?.moveIns ?? null)}
              context={`${formatMonth(month)} completed move-ins`}
              to="/flash"
            />
            <KpiCard
              label="Move-outs month to date"
              value={num(monthPeriod?.moveOuts ?? null)}
              context={`${formatMonth(month)} completed move-outs`}
              to="/flash"
            />
            <KpiCard
              label="Net move-ins month to date"
              value={signed(monthPeriod?.net ?? null)}
              tone={
                monthPeriod?.net == null || monthPeriod.net === 0
                  ? "neutral"
                  : monthPeriod.net > 0
                    ? "up"
                    : "down"
              }
              context={
                monthPeriod?.pendingNet == null
                  ? "Move-ins less move-outs"
                  : `${signed(monthPeriod.pendingNet)} more scheduled for the rest of the month`
              }
              to="/flash"
            />
          </div>
        )}
      </section>

      {/* 4 — Marketing & Sales Pulse -------------------------------------- */}
      <MarketingSalesPulse
        loading={sales.isLoading}
        summary={sales.data ?? null}
        gsc={(gsc.data as GscTotals | null | undefined) ?? null}
        gscLoading={gsc.isLoading}
        rangeLabel={formatRangeLabel(dateRange)}
        period={{ start, end }}
      />

      {/* 5 — Community Watchlist ------------------------------------------ */}
      <CommunityWatchlist
        organizationId={ctx.organizationId}
        communities={perCommunity}
        loading={occupancy.isLoading}
        month={month}
        week={week}
        onOpen={(id) => {
          setCommunityScope({ mode: "communities", communityIds: [id] });
          void navigate({ to: "/occupancy" });
        }}
      />

      {/* 6 — What Changed --------------------------------------------------*/}
      <WhatChanged
        comparisonLabel={
          comparisonMode === "none" ? null : `${comparisonModeLabel(comparisonMode)} · ${formatPeriodLabel(comparisonRange)}`
        }
        current={sales.data ?? null}
        prior={comparisonRange ? (priorSales.data ?? null) : null}
        gsc={(gsc.data as GscTotals | null | undefined) ?? null}
        priorGsc={comparisonRange ? ((priorGsc.data as GscTotals | null | undefined) ?? null) : null}
        occupancyChangePoints={occupancyChangePoints(trend.data ?? [])}
      />

      {/* 7 — Opportunities & Attention ------------------------------------ */}
      <Opportunities
        organizationId={ctx.organizationId}
        period={{ start, end }}
        communities={perCommunity}
        occupancyChangePoints={occupancyChangePoints(trend.data ?? [])}
        snapshotIssues={(snapshotHealth.data ?? []).filter((r) => r.snapshot_missing || r.source_stale)}
      />
    </div>
  );
}

type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  avg_position: number | null;
  days: number;
  first_date: string | null;
  last_date: string | null;
};

/** Occupancy movement across the selected range, from stored snapshots only. */
function occupancyChangePoints(points: { occupancy_pct: number | null }[]): number | null {
  const withValue = points.filter((p) => p.occupancy_pct != null);
  if (withValue.length < 2) return null;
  const first = Number(withValue[0]!.occupancy_pct);
  const last = Number(withValue[withValue.length - 1]!.occupancy_pct);
  return (last - first) * 100;
}

// ---------------------------------------------------------------------------
// Marketing & Sales Pulse
// ---------------------------------------------------------------------------

function MarketingSalesPulse({
  loading,
  summary,
  gsc,
  gscLoading,
  rangeLabel,
  period,
}: {
  loading: boolean;
  summary: { inquiries: number; tours: number; reTours: number; deposits: number } | null;
  gsc: GscTotals | null;
  gscLoading: boolean;
  rangeLabel: string;
  period: { start: string; end: string };
}) {
  // Search Console coverage is stated honestly: daily facts either cover the
  // selected range or they do not. Nothing is prorated or estimated.
  const hasSearch = !!gsc && gsc.impressions + gsc.clicks > 0;
  const partial =
    hasSearch && ((gsc!.last_date ?? "") < period.end || (gsc!.first_date ?? period.start) > period.start);

  return (
    <section className="space-y-3">
      <SectionHeading title="Marketing & sales pulse" hint={`Period events for ${rangeLabel}.`} />
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="kpi-card h-28 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard label="New inquiries" value={num(summary?.inquiries ?? null)} to="/sales" />
          <KpiCard label="Completed tours" value={num(summary?.tours ?? null)} to="/sales" />
          <KpiCard
            label="Re-tours"
            value={num(summary?.reTours ?? null)}
            context="Repeat completed tours"
            to="/sales"
          />
          <KpiCard
            label="Deposits"
            value={num(summary?.deposits ?? null)}
            badge="Provisional"
            context="Distinct depositors with a standard deposit in the period"
            to="/sales"
          />
          {gscLoading ? (
            <div className="kpi-card h-28 animate-pulse" />
          ) : hasSearch ? (
            <KpiCard
              label="Organic search clicks"
              value={num(gsc!.clicks)}
              badge={partial ? "Partial" : undefined}
              context={
                partial
                  ? `Imports cover ${gsc!.first_date} – ${gsc!.last_date} of this range`
                  : `${gsc!.days} days of imported daily data`
              }
              to="/marketing"
            />
          ) : (
            <UnavailableCard label="Organic search clicks" />
          )}
          {gscLoading ? (
            <div className="kpi-card h-28 animate-pulse" />
          ) : hasSearch ? (
            <KpiCard
              label="Organic search impressions"
              value={num(gsc!.impressions)}
              badge={partial ? "Partial" : undefined}
              context={
                gsc!.ctr == null ? undefined : `${(Number(gsc!.ctr) * 100).toFixed(1)}% click-through rate`
              }
              to="/marketing"
            />
          ) : (
            <UnavailableCard label="Organic search impressions" />
          )}
        </div>
      )}
    </section>
  );
}

function UnavailableCard({ label }: { label: string }) {
  return (
    <div className="kpi-card h-full space-y-1.5 p-5">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight text-muted-foreground">{na}</p>
      <p className="text-xs leading-snug text-muted-foreground">
        No Search Console daily export covers this date range. Import one from Admin → Search
        Console Imports; nothing is estimated.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Community Watchlist
// ---------------------------------------------------------------------------

type CommunityEntry = {
  row: CommunityOccupancy;
  budget: { units: number | null; pct: number | null; variancePoints: number | null };
};

function CommunityWatchlist({
  organizationId,
  communities,
  loading,
  month,
  week,
  onOpen,
}: {
  organizationId: string | null;
  communities: CommunityEntry[];
  loading: boolean;
  month: string;
  week: { start: string; end: string };
  onOpen: (communityId: string) => void;
}) {
  // Deterministic ranking: worst budget variance first; communities with no
  // budget rank on raw occupancy after those with one. No AI, no heuristics.
  const ranked = useMemo(() => {
    const withBudget = communities
      .filter((c) => c.budget.variancePoints != null)
      .sort((a, b) => a.budget.variancePoints! - b.budget.variancePoints!);
    const withoutBudget = communities
      .filter((c) => c.budget.variancePoints == null)
      .sort((a, b) => (a.row.occupancy_pct ?? 1) - (b.row.occupancy_pct ?? 1));
    return [...withBudget, ...withoutBudget].slice(0, 5);
  }, [communities]);

  const ids = ranked.map((c) => c.row.id);
  const { byCommunity } = useFlashReportsByCommunity(organizationId, ids, week.start, week.end, month);

  const columns: Column<CommunityEntry>[] = [
    {
      key: "community",
      header: "Community",
      render: (c) => (
        <button
          type="button"
          onClick={() => onOpen(c.row.id)}
          className="text-left text-sm font-medium text-brand hover:underline"
        >
          {c.row.name}
        </button>
      ),
    },
    {
      key: "current",
      header: "Current occupancy",
      align: "right",
      render: (c) => (
        <span>
          {pct1(c.row.occupancy_pct)}
          <span className="ml-1 text-xs text-muted-foreground">
            {c.row.occupied_units}/{c.row.census_units}
          </span>
        </span>
      ),
    },
    {
      key: "budget",
      header: "Budget",
      align: "right",
      render: (c) => pct1(c.budget.pct),
    },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      render: (c) => (
        <span
          className={cn(
            "font-medium",
            c.budget.variancePoints == null
              ? "text-muted-foreground"
              : c.budget.variancePoints >= 0
                ? "text-success"
                : "text-destructive",
          )}
        >
          {pts1(c.budget.variancePoints)}
        </span>
      ),
    },
    {
      key: "eom",
      header: "Projected EOM",
      align: "right",
      render: (c) => {
        const p = byCommunity[c.row.id]?.month?.projectedOccupancyPct;
        return p == null ? na : `${Number(p).toFixed(1)}%`;
      },
    },
  ];

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Community watchlist"
        hint="The five communities furthest below occupancy budget. Select one to open Occupancy Intelligence for it."
      />
      <DataTable
        columns={columns}
        rows={ranked}
        loading={loading}
        empty={
          <EmptyState
            title="No communities to rank"
            description="Occupancy data is needed before communities can be ranked against budget."
          />
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// What Changed
// ---------------------------------------------------------------------------

function WhatChanged({
  comparisonLabel,
  current,
  prior,
  gsc,
  priorGsc,
  occupancyChangePoints: occChange,
}: {
  comparisonLabel: string | null;
  current: { inquiries: number; tours: number; moveIns: number; moveOuts: number } | null;
  prior: { inquiries: number; tours: number; moveIns: number; moveOuts: number } | null;
  gsc: GscTotals | null;
  priorGsc: GscTotals | null;
  occupancyChangePoints: number | null;
}) {
  if (!comparisonLabel) {
    return (
      <section className="space-y-3">
        <SectionHeading title="What changed" />
        <p className="panel px-4 py-3 text-xs text-muted-foreground">
          Choose a comparison period in the filter bar to see period-over-period movement. Nothing
          is compared until you pick a baseline.
        </p>
      </section>
    );
  }

  const items: { label: string; value: string; tone: "up" | "down" | "neutral"; note?: string }[] = [];

  const add = (label: string, cur: number | null | undefined, prev: number | null | undefined) => {
    if (cur == null || prev == null) return;
    const d = deltaPct(cur, prev);
    const diff = cur - prev;
    items.push({
      label,
      value: d == null ? signed(diff) : `${signed(diff)} (${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(0)}%)`,
      tone: diff > 0 ? "up" : diff < 0 ? "down" : "neutral",
      note: `${num(prev)} → ${num(cur)}`,
    });
  };

  if (occChange != null) {
    items.push({
      label: "Occupancy across the selected range",
      value: pts1(occChange),
      tone: occChange > 0 ? "up" : occChange < 0 ? "down" : "neutral",
      note: "From stored daily snapshots",
    });
  }
  add("New inquiries", current?.inquiries, prior?.inquiries);
  add("Completed tours", current?.tours, prior?.tours);
  add("Move-ins", current?.moveIns, prior?.moveIns);
  add("Move-outs", current?.moveOuts, prior?.moveOuts);
  if (gsc && priorGsc && priorGsc.impressions + priorGsc.clicks > 0) {
    add("Organic clicks", gsc.clicks, priorGsc.clicks);
  }

  return (
    <section className="space-y-3">
      <SectionHeading title="What changed" hint={`Compared with ${comparisonLabel}.`} />
      {items.length === 0 ? (
        <p className="panel px-4 py-3 text-xs text-muted-foreground">
          No comparable data exists for the comparison period.
        </p>
      ) : (
        <ul className="panel divide-y divide-border">
          {items.map((i) => (
            <li key={i.label} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{i.label}</p>
                {i.note ? <p className="text-xs text-muted-foreground">{i.note}</p> : null}
              </div>
              <span
                className={cn(
                  "text-sm font-semibold",
                  i.tone === "up" && "text-success",
                  i.tone === "down" && "text-destructive",
                  i.tone === "neutral" && "text-muted-foreground",
                )}
              >
                {i.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Opportunities & Attention
// ---------------------------------------------------------------------------

function Opportunities({
  organizationId,
  period,
  communities,
  occupancyChangePoints: occChange,
  snapshotIssues,
}: {
  organizationId: string | null;
  period: { start: string; end: string };
  communities: CommunityEntry[];
  occupancyChangePoints: number | null;
  snapshotIssues: { community_name: string }[];
}) {
  // SEO opportunity uses the Pages export only when its exported period equals
  // the selected range — aggregate exports are never prorated.
  const grains = useGrainImports(organizationId, "page");
  const selection = selectImportForPeriod(grains.data ?? [], period);
  const pages = usePageReport(
    organizationId,
    selection.coverage === "exact" ? (selection.current?.import_id ?? null) : null,
    null,
  );

  const pageRows = (pages.data ?? []) as {
    page_url: string;
    clicks: number;
    impressions: number;
    ctr: number | null;
  }[];
  const totalClicks = pageRows.reduce((s, r) => s + r.clicks, 0);
  const totalImpr = pageRows.reduce((s, r) => s + r.impressions, 0);
  const siteCtr = totalImpr ? totalClicks / totalImpr : null;
  const seoOpportunities =
    siteCtr == null
      ? []
      : pageRows
          .filter((r) => r.impressions >= 100 && (r.ctr ?? 0) < siteCtr / 2)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 3);

  const belowBudget = communities
    .filter((c) => c.budget.variancePoints != null && c.budget.variancePoints < -2)
    .sort((a, b) => a.budget.variancePoints! - b.budget.variancePoints!);

  const items: { tone: "attention" | "positive" | "neutral"; title: string; body: string }[] = [];

  if (belowBudget.length) {
    items.push({
      tone: "attention",
      title: `${belowBudget.length} ${belowBudget.length === 1 ? "community" : "communities"} more than 2 points below occupancy budget`,
      body: belowBudget
        .slice(0, 4)
        .map((c) => `${c.row.name} ${pts1(c.budget.variancePoints)}`)
        .join(" · "),
    });
  }
  if (occChange != null && occChange >= 1) {
    items.push({
      tone: "positive",
      title: `Occupancy up ${pts1(occChange)} across the selected range`,
      body: "Measured from the first to the last stored daily snapshot in the range.",
    });
  }
  for (const p of seoOpportunities) {
    items.push({
      tone: "neutral",
      title: "High impressions, low click-through",
      body: `${p.page_url} — ${num(p.impressions)} impressions at ${p.ctr == null ? na : `${(p.ctr * 100).toFixed(1)}%`} CTR (site ${((siteCtr ?? 0) * 100).toFixed(1)}%).`,
    });
  }
  if (snapshotIssues.length) {
    items.push({
      tone: "attention",
      title: `${snapshotIssues.length} ${snapshotIssues.length === 1 ? "community has" : "communities have"} a data freshness warning`,
      body: snapshotIssues
        .slice(0, 4)
        .map((s) => s.community_name)
        .join(" · "),
    });
  }

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Opportunities & attention"
        hint="Deterministic signals from the data already in the platform."
        action={
          <Link to="/data-health" className="text-xs font-medium text-brand hover:underline">
            Data Health
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="panel px-4 py-3 text-xs text-muted-foreground">
          Nothing is flagged for this selection right now.
        </p>
      ) : (
        <ul className="panel divide-y divide-border">
          {items.map((i, idx) => (
            <li key={idx} className="flex items-start gap-3 px-4 py-3">
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  i.tone === "attention" && "bg-destructive",
                  i.tone === "positive" && "bg-success",
                  i.tone === "neutral" && "bg-brand",
                )}
              />
              <div>
                <p className="text-sm font-medium text-foreground">{i.title}</p>
                <p className="text-xs leading-snug text-muted-foreground">{i.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
