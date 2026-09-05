import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { ConversionRatesTab } from "@/components/clarity/conversion-rates";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { CandidateMetricCard, ProvisionalBadge, WithheldPanel } from "@/components/clarity/provisional";
import {
  CHART_TOKENS,
  ChartCard,
  FunnelChart,
  GroupedBarChart,
  HorizontalBarChart,
  MetricTrendChart,
  ProgressGauge,
  type BarDatum,
} from "@/components/clarity/charts";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { SeriesToggleChips, useSeriesVisibility } from "@/components/clarity/series-toggle";
import {
  LostLeadsTab,
  MoveInsByLeadSourceTab,
  MoveOutReasonsTab,
  NewInquiriesTab,
  OccupancyHistoryTab,
} from "@/components/clarity/sales-reports";
import { ratio } from "@/lib/wh/metrics";
import { comparisonSuffix, formatPeriodLabel } from "@/lib/date-ranges";
import { cn } from "@/lib/utils";
import { WH_ACTIVITY_CATEGORY_LABELS, type WhActivityCategory } from "@/lib/wh/tables";
import {
  candidate,
  useWhActivityMix,
  useWhDepositPage,
  useWhMoveInPage,
  useWhSalesTrend,
  useWhTourPage,
  useWhProspectPage,
  useWhSalesSummary,
  useWhUnitCensusReport,
  withheld,
  UNIT_EXCLUSION_LABELS,
  type WhProspectBucket,
  type WhSalesSummary,
} from "@/lib/wh/summary";

import { resolveLabel, useWhContext, useWhLabelMaps } from "@/lib/wh/use-wh";
import { effectiveBudget } from "@/lib/wh/occupancy";
import { useFlashBudgets } from "@/lib/flash/queries";
import { useOccupancyTrend } from "@/lib/wh/snapshots";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "Sales Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Inquiry, tour, deposit and move-in performance calculated deterministically from WelcomeHome CRM records.",
      },
      { property: "og:title", content: "Sales Intelligence — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Funnel, trends, pipeline health, counselor activity and occupancy from CRM data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesIntelligence,
});

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = (iso: string) => MONTH_FMT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** Previous period of identical length, immediately before the selected one. */
function priorPeriod(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  const pe = new Date(s.getTime() - 86400000);
  const ps = new Date(pe.getTime() - (days - 1) * 86400000);
  return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
}

/**
 * Sales Intelligence.
 *
 * Every figure and every chart series on this page is produced by a database
 * function (wh_sales_summary, wh_sales_trend, wh_activity_mix) over the
 * complete normalized WelcomeHome dataset, filtered by organization
 * authorization, the selected communities and the selected dates before
 * aggregation. The browser receives aggregates, not records, so accuracy is
 * identical at 2,000 or 500,000 source rows. Record-level lists are paginated
 * server-side. No KPI definition is computed client-side.
 */
function SalesIntelligence() {
  const ctx = useWhContext();
  const labels = useWhLabelMaps(ctx.connectionId);
  const budgets = useFlashBudgets(ctx.organizationId);
  const summary = useWhSalesSummary(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
  );
  // Global comparison picker wins; otherwise fall back to the prior equal-length period.
  const prior = ctx.comparisonRange ?? priorPeriod(ctx.dateRange.start, ctx.dateRange.end);
  const comparisonLabel = ctx.comparisonRange
    ? comparisonSuffix(ctx.comparisonMode)
    : "vs prior equal-length period";
  const priorSummary = useWhSalesSummary(ctx.organizationId, ctx.communityIds, prior.start, prior.end);
  // Occupancy comparison comes from the canonical historical resolver
  // (nightly snapshot first, official imported daily history next). Disabled
  // entirely when no comparison period is selected.
  const priorOccupancy = useOccupancyTrend(
    ctx.comparisonRange ? ctx.organizationId : null,
    ctx.communityIds,
    prior.start,
    prior.end,
    "daily",
  );
  const trend = useWhSalesTrend(ctx.organizationId, ctx.communityIds, ctx.dateRange.end, 12);
  const [tab, setTab] = useState("funnel");

  const trendData = useMemo(
    () =>
      (trend.data ?? []).map((r) => ({
        label: monthLabel(r.month),
        inquiries: r.inquiries,
        tours: r.tours,
        re_tours: r.re_tours,
        deposits: r.deposits,
        move_ins: r.move_ins,
        move_outs: r.move_outs,
        net_move_ins: r.net_move_ins,
      })),
    [trend.data],
  );

  if (!ctx.connection) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="WelcomeHome is not connected"
          description="Connect WelcomeHome in Admin → WelcomeHome Connection, map your communities, then run a sync."
        />
      </div>
    );
  }

  if (ctx.loading || summary.isLoading) {
    return <div className="panel px-6 py-16 text-center text-sm text-muted-foreground">Loading CRM data…</div>;
  }

  if (summary.error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="Sales metrics could not be calculated"
          description={(summary.error as Error).message}
        />
      </div>
    );
  }

  const s = summary.data;
  const budgetRows = budgets.data ?? [];

  if (!s || s.exclusions.total === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="No WelcomeHome records for this selection"
          description="Either no sync has completed yet, or the selected communities have no mapped WelcomeHome community. Nothing is estimated to fill the gap."
        />
      </div>
    );
  }

  const p = priorSummary.data;
  const cmp = (current: number, previous: number | undefined) =>
    p && previous != null
      ? { previous, label: `${formatPeriodLabel(prior)} · ${comparisonLabel}` }
      : undefined;

  const deposits = candidate(
    s.deposits,
    "API-derived standard deposits. Known WelcomeHome reporting limitation documented in Validation Center.",
  );

  const hot = s.mappings.hot
    ? candidate(s.hot, "Open prospects whose score is mapped to Hot.")
    : withheld("No WelcomeHome score is mapped to Hot yet.");
  const hotNoActivity = s.mappings.hot
    ? candidate(s.hotNoActivity, `Hot prospects with no future scheduled activity (${s.settings.hot_no_activity_mode}).`)
    : withheld("Requires a score mapped to Hot.");
  const stalled = candidate(
    s.stalled,
    `Open prospects with no contact for ${s.settings.stalled_threshold_days}+ days.`,
  );

  // Latest historical occupancy percentage inside the comparison window.
  const priorOccupancyPct = (() => {
    const rows = priorOccupancy.data ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const pct = rows[i]?.occupancy_pct;
      // wh_occupancy_trend returns a 0–1 ratio; the strip works in percent.
      if (pct != null) return Number(pct) * 100;
    }
    return null;
  })();

  const occRaw = ratio(s.occupancy.occupiedUnitsCandidate, s.occupancy.censusUnits);
  const occDisplay = s.occupancy.censusUnits
    ? `${Math.round((s.occupancy.occupiedUnitsCandidate / s.occupancy.censusUnits) * 100)}%`
    : "—";

  // Budgeted occupied units in force today, summed over the communities in scope.
  const budgetUnits = ctx.communityIds.reduce<number | null>((acc, id) => {
    const b = effectiveBudget(budgetRows, id);
    const units =
      b?.budget_occupied_units != null ? Number(b.budget_occupied_units) : null;
    return units == null ? acc : (acc ?? 0) + units;
  }, null);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Sales Intelligence"
        description="Inquiry, tour, deposit, move-in and occupancy performance from WelcomeHome, aggregated in the database over the complete dataset and converted to community-local dates."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="funnel">Funnel</TabsTrigger>
            <TabsTrigger value="occupancy-history">Occupancy history</TabsTrigger>
            <TabsTrigger value="inquiries">New inquiries</TabsTrigger>
            <TabsTrigger value="sources">Lead sources</TabsTrigger>
            <TabsTrigger value="conversion">Conversion rates</TabsTrigger>
            <TabsTrigger value="mi-sources">Move-ins by lead source</TabsTrigger>
            <TabsTrigger value="lost-leads">Lost leads</TabsTrigger>
            <TabsTrigger value="move-out-reasons">Move-out reasons</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline health</TabsTrigger>
            <TabsTrigger value="counselors">Counselors</TabsTrigger>
            <TabsTrigger value="occupancy">Current occupancy</TabsTrigger>
          </TabsList>
        </div>

        {/* ---------------------------------------------------------------- Funnel */}
        <TabsContent value="funnel" className="space-y-8 pt-6">
          <ExecutiveSummaryStrip
            occupancy={s.occupancy}
            budgetUnits={budgetUnits}
            moveIns={s.moveIns}
            moveOuts={s.moveOuts}
            tours={s.mappings.tour ? s.tours : null}
            periodLabel={`${ctx.dateRange.start} – ${ctx.dateRange.end}`}
            occupancyComparison={
              ctx.comparisonRange
                ? {
                    pct: priorOccupancyPct,
                    label: comparisonLabel,
                  }
                : null
            }
          />

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

            <KpiCard
              label="New inquiries"
              value={s.inquiries}
              note="Countable prospects whose WelcomeHome active date falls in the period."
              compare={cmp(s.inquiries, p?.inquiries)}
            />
            <KpiCard
              label="Completed tours"
              value={s.mappings.tour ? s.tours : null}
              note={
                s.mappings.tour
                  ? "Tour activities completed in the period with a successful WelcomeHome result."
                  : "No WelcomeHome activity type is mapped to Tour yet."
              }
              compare={s.mappings.tour ? cmp(s.tours, p?.tours) : undefined}
            />
            <KpiCard
              label="Re-tours"
              value={s.mappings.tour ? s.tourRecon.repeatTours : null}
              note={
                s.mappings.tour
                  ? "Successful repeat tours — not the prospect's first completed tour."
                  : "Requires an activity type mapped to Tour."
              }
              compare={s.mappings.tour ? cmp(s.tourRecon.repeatTours, p?.tourRecon.repeatTours) : undefined}
            />
            <CandidateMetricCard label="Deposits" candidate={deposits} />
            <KpiCard
              label="Move-ins"
              value={s.moveIns}
              note="Counted move-ins by financial move-in date, canceled leases excluded."
              compare={cmp(s.moveIns, p?.moveIns)}
            />
            <KpiCard
              label="Move-outs"
              value={s.moveOuts}
              note="Counted move-outs by financial move-out date, canceled leases excluded."
              compare={cmp(s.moveOuts, p?.moveOuts)}
              invertDelta
            />
            <KpiCard
              label="Net move-ins"
              value={s.moveIns - s.moveOuts}
              note="Move-ins minus move-outs for the selected period."
              compare={p ? cmp(s.moveIns - s.moveOuts, p.moveIns - p.moveOuts) : undefined}
            />
            
            <KpiCard
              label="Pending move-ins / outs"
              display={`${s.pending.pendingIn} / ${s.pending.pendingOut}`}
              value={s.pending.pendingIn}
              note="Future-dated contracts. Current state, not affected by the date filter."
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Period activity funnel"
              description="Shows events occurring in the selected period. These are not necessarily the same prospects at each stage, so the ratios are operational volume comparisons, not conversion rates."
              height={300}
            >
              <FunnelChart
                stages={[
                  { label: "New inquiries", value: s.inquiries },
                  ...(s.mappings.tour ? [{ label: "Successful tours", value: s.tours }] : []),
                  { label: "Deposits", value: s.deposits, provisional: true },
                  { label: "Move-ins", value: s.moveIns },
                ]}
              />
            </ChartCard>

            <MoveTrendCard data={trendData} loading={trend.isLoading} />
          </div>

          <SalesTrendCard data={trendData} loading={trend.isLoading} />

          <section className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Cohort conversion</h2>
              <ProvisionalBadge />
              {s.cohort.linkageCoverage != null && s.cohort.linkageCoverage < 0.95 ? (
                <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[11px] font-medium text-warning">
                  Directional only
                </span>
              ) : null}
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Leads created in this period and what they have done since — a different question from
              the period-event funnel above, and never blended with it.
            </p>
            <div className="grid gap-4 md:grid-cols-4">
              <Stat label="Cohort size" value={s.cohort.cohortSize} />
              <Stat
                label="Toured"
                value={s.cohort.toured ?? "—"}
                sub={pct(ratio(s.cohort.toured, s.cohort.cohortSize))}
              />
              <Stat
                label="Deposited"
                value={s.cohort.deposited}
                sub={pct(ratio(s.cohort.deposited, s.cohort.cohortSize))}
              />
              <Stat
                label="Moved in"
                value={s.cohort.movedIn}
                sub={pct(ratio(s.cohort.movedIn, s.cohort.cohortSize))}
              />
            </div>
            {s.cohort.linkageCoverage != null && s.cohort.linkageCoverage < 0.95 ? (
              <p className="text-xs text-warning">
                Only {pct(s.cohort.linkageCoverage)} of activities carry a prospect link, so
                tour-level conversion understates reality. Treat it as a floor, not a rate.
              </p>
            ) : null}
            {s.cohort.toured == null ? (
              <p className="text-xs text-muted-foreground">
                Tour conversion is withheld until an activity type is mapped to Tour.
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Audit &amp; supporting records</h2>
              <p className="text-xs text-muted-foreground">
                Full traceability for every headline number. Nothing here is summarized or estimated;
                each panel lists the exact records the database counted.
              </p>
            </div>
            <Accordion type="multiple" className="panel px-5">
              <AccordionItem value="exclusions">
                <AccordionTrigger className="text-sm">Prospect exclusions</AccordionTrigger>
                <AccordionContent>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Counted in the database across every stored record. Excluded rows are retained
                    for audit, never deleted.
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    <li>Total prospects stored: {s.exclusions.total.toLocaleString()}</li>
                    <li>Merged duplicates excluded: {s.exclusions.merged.toLocaleString()}</li>
                    <li>Discarded excluded: {s.exclusions.discarded.toLocaleString()}</li>
                    <li className="text-foreground">Countable: {s.exclusions.countable.toLocaleString()}</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="tour-recon">
                <AccordionTrigger className="text-sm">Tour reconciliation</AccordionTrigger>
                <AccordionContent>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Successful tours are tour activities completed in the period whose WelcomeHome
                    activity result is flagged successful.
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    <li className="text-foreground">Successful tours (KPI): {s.tourRecon.successfulTours}</li>
                    <li>Initial tours: {s.tourRecon.initialTours}</li>
                    <li>Repeat tours: {s.tourRecon.repeatTours}</li>
                  </ul>
                  <p className="eyebrow pt-2">Diagnostic components — not KPI values</p>
                  <ul className="text-xs text-muted-foreground">
                    <li>Total tour activities: {s.tourRecon.totalTourActivities}</li>
                    <li>Unsuccessful / excluded: {s.tourRecon.unsuccessfulTours}</li>
                    {s.tourRecon.byResult.map((r) => (
                      <li key={r.result}>
                        {r.result}: {r.n} ({r.successful ? "successful" : "not successful"})
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="deposit-recon">
                <AccordionTrigger className="text-sm">Deposit and move-in reconciliation</AccordionTrigger>
                <AccordionContent>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Deposits (provisional): distinct depositors with a standard deposit dated in the
                    selected period, matching WelcomeHome's Depositor List rather than a count of
                    transaction rows. A known WelcomeHome reporting limitation is documented in
                    Validation Center.
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    <li>Counted depositors: {s.depositRecon.depositors}</li>
                    <li>Standard deposit transaction rows: {s.depositRecon.fromTransactions}</li>
                    <li>HousingContract deposit fields: {s.depositRecon.fromContracts}</li>
                  </ul>
                  <p className="eyebrow pt-2">Diagnostic components — not KPI values</p>
                  <ul className="text-xs text-muted-foreground">
                    <li>Zero-amount adjustment rows: {s.depositRecon.zeroAmountRows}</li>
                    <li>Refund transactions: {s.depositRecon.refunds}</li>
                    <li>Waitlist Deposit transactions: {s.depositRecon.waitlist}</li>
                    <li>Other deposit types: {s.depositRecon.otherTypes}</li>
                    <li>Transfer Ins (not counted as move-ins): {s.moveRecon.transferIns}</li>
                    <li>Transfer Outs (not counted as move-outs): {s.moveRecon.transferOuts}</li>
                    <li>
                      Canceled leases excluded — in: {s.moveRecon.canceledMoveIns}, out:{" "}
                      {s.moveRecon.canceledMoveOuts}
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="tour-rows">
                <AccordionTrigger className="text-sm">Counted tour activities</AccordionTrigger>
                <AccordionContent>
                  <TourDrillThrough />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="deposit-rows">
                <AccordionTrigger className="text-sm">Counted deposits</AccordionTrigger>
                <AccordionContent>
                  <DepositDrillThrough />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="move-in-rows">
                <AccordionTrigger className="text-sm">Counted move-ins</AccordionTrigger>
                <AccordionContent>
                  <MoveInDrillThrough />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        </TabsContent>

        {/* -------------------------------------------------------- Pipeline health */}
        <TabsContent value="pipeline" className="space-y-8 pt-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Open pipeline" value={s.pipeline} sub="Current state" />
            <CandidateMetricCard label="Hot leads" candidate={hot} />
            <CandidateMetricCard label="Hot, no future activity" candidate={hotNoActivity} />
            <CandidateMetricCard label="Stalled prospects" candidate={stalled} />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Current pipeline by stage"
              badge={
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Current state
                </span>
              }
              description="Where open prospects sit right now. Historical stage distribution requires WelcomeHome Daily Snapshots, so no stage trend is drawn."
              empty={s.stageDistribution.length === 0 ? "No open prospects in this selection." : undefined}
              height={Math.max(220, s.stageDistribution.length * 34 + 40)}
            >
              <HorizontalBarChart
                data={s.stageDistribution.map((r) => ({
                  label: resolveLabel(labels.stage, r.id, "Unknown stage"),
                  value: r.n,
                }))}
                valueLabel="Open prospects"
              />
            </ChartCard>

            <ChartCard
              title="Pipeline attention"
              description="Open prospects that need follow-up, measured against the open pipeline. These are counts from the same server aggregate — not a risk score."
              height={260}
            >
              <div className="flex h-full flex-col justify-center gap-5">
                <AttentionBar label="Overdue next activity" value={s.overdue} total={s.pipeline} />
                <AttentionBar
                  label="Hot, no future activity"
                  value={s.mappings.hot ? s.hotNoActivity : null}
                  total={s.pipeline}
                  withheldNote="Requires a WelcomeHome score mapped to Hot."
                />
                <AttentionBar
                  label={`Stalled (${s.settings.stalled_threshold_days}+ days no contact)`}
                  value={s.stalled}
                  total={s.pipeline}
                />
              </div>
            </ChartCard>
          </div>

          <ActivityMixCard />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Prospect drill-through</h2>
            <ProspectDrillThrough />
          </section>
        </TabsContent>

        {/* ------------------------------------------------------------ Counselors */}
        <TabsContent value="counselors" className="space-y-6 pt-6">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Activity attribution uses the owning user recorded on each WelcomeHome activity and the
            sales counselor recorded on each contract. Unassigned records are not redistributed, and
            no ranking or performance score is inferred.
          </p>
          <div className="grid gap-6 xl:grid-cols-3">
            <CounselorChart
              title="Counselor activity"
              description="Completed activities in the selected period."
              rows={s.counselors.map((c) => ({ label: resolveLabel(labels.user, c.id, "Unknown counselor"), value: c.activities }))}
              valueLabel="Activities"
            />
            <CounselorChart
              title="Tours by counselor"
              description="Successful tour activities in the selected period."
              rows={s.counselors.map((c) => ({ label: resolveLabel(labels.user, c.id, "Unknown counselor"), value: c.tours }))}
              valueLabel="Tours"
              color={CHART_TOKENS.secondary}
            />
            <CounselorChart
              title="Move-ins by counselor"
              description="Counted move-ins attributed by contract sales counselor."
              rows={s.counselors.map((c) => ({ label: resolveLabel(labels.user, c.id, "Unknown counselor"), value: c.moveIns }))}
              valueLabel="Move-ins"
              color={CHART_TOKENS.tertiary}
            />
          </div>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">All counselors</h2>
            <DataTable
              columns={[
                { key: "user", header: "Counselor", render: (r: any) => resolveLabel(labels.user, r.id, "Unknown counselor") },
                { key: "act", header: "Activities", align: "right", render: (r: any) => r.activities },
                { key: "tours", header: "Tours", align: "right", render: (r: any) => r.tours },
                { key: "mi", header: "Move-ins", align: "right", render: (r: any) => r.moveIns },
                { key: "pipe", header: "Open pipeline", align: "right", render: (r: any) => r.pipeline },
              ]}
              rows={s.counselors as any[]}
              empty={<EmptyState title="No counselor activity in this period" />}
            />
          </section>
        </TabsContent>

        {/* ----------------------------------------------------------- Lead sources */}
        <TabsContent value="sources" className="space-y-6 pt-6">
          <LeadSourceMix
            rows={s.leadSources.map((r) => ({
              id: r.id,
              label: resolveLabel(labels.leadSource, r.id, "Unknown lead source"),
              inquiries: r.inquiries,
              tours: r.tours ?? 0,
              moveIns: r.moveIns,
            }))}
            totals={{ inquiries: s.inquiries, tours: s.tours, moveIns: s.moveIns }}
            reTours={s.reTours}
            prior={p ? { inquiries: p.inquiries, tours: p.tours, moveIns: p.moveIns } : null}
            comparisonLabel={`${formatPeriodLabel(prior)} · ${comparisonLabel}`}
            utm={s.utm}
          />
        </TabsContent>

        {/* -------------------------------------------------------- Conversion rates */}
        <TabsContent value="conversion" className="space-y-6 pt-6">
          <ConversionRatesTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            range={ctx.dateRange}
            prior={prior}
            comparisonLabel={comparisonLabel}
            priorLabel={formatPeriodLabel(prior)}
            communityNames={ctx.communityNames}
            counselorLabel={(id) => resolveLabel(labels.user, id, "Unassigned")}
            leadSourceLabel={(id) => resolveLabel(labels.leadSource, id, "Unknown lead source")}
            onDrill={(t) => setTab(t)}
          />
        </TabsContent>

        {/* ------------------------------------------------------ Current occupancy */}
        <TabsContent value="occupancy" className="space-y-6 pt-6">
          <section className="panel space-y-5 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Current occupancy</h2>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Current state
              </span>
            </div>
            <ProgressGauge
              value={s.occupancy.occupiedUnitsCandidate}
              total={s.occupancy.censusUnits}
              display={occDisplay}
              caption={`${pct(occRaw)} raw · ${occDisplay} WelcomeHome-equivalent rounded display. The denominator counts census-eligible residential units only; non-residential pseudo-units such as WAITLIST are excluded by a configurable rule, never by a community-specific override.`}
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Stat label="Census-eligible units" value={s.occupancy.censusUnits} />
              <Stat label="Occupied (current)" value={s.occupancy.occupiedUnitsCandidate} />
              <Stat label="On notice" value={s.occupancy.noticeCount} />
              <Stat label="Pending move-ins" value={s.occupancy.pendingMoveIns} />
              <Stat label="Explicit off-census units" value={s.occupancy.offCensusUnits} />
              <Stat label="Pseudo/non-residential units" value={s.occupancy.pseudoUnits} />
            </div>
            <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              Not affected by historical date selection. Historical occupancy requires WelcomeHome
              Daily Snapshots. These values are derived from the latest known unit and
              housing-contract state, never reconstructed backwards from present-state rows.
            </p>
          </section>

          <Accordion type="single" collapsible className="panel px-5">
            <AccordionItem value="units">
              <AccordionTrigger className="text-sm">Excluded unit records</AccordionTrigger>
              <AccordionContent>
                <UnitCensusDiagnostic totalUnits={s.occupancy.totalUnits} inactive={s.occupancy.inactiveUnits} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        {/* -------------------------------------------- Standard reports */}
        <TabsContent value="occupancy-history" className="space-y-6 pt-6">
          <OccupancyHistoryTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            start={ctx.dateRange.start}
            end={ctx.dateRange.end}
          />

        </TabsContent>

        <TabsContent value="mi-sources" className="space-y-6 pt-6">
          <MoveInsByLeadSourceTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            end={ctx.dateRange.end}
          />
        </TabsContent>

        <TabsContent value="move-out-reasons" className="space-y-6 pt-6">
          <MoveOutReasonsTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            end={ctx.dateRange.end}
          />
        </TabsContent>

        <TabsContent value="inquiries" className="space-y-6 pt-6">
          <NewInquiriesTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            end={ctx.dateRange.end}
          />
        </TabsContent>

        <TabsContent value="lost-leads" className="space-y-6 pt-6">
          <LostLeadsTab
            organizationId={ctx.organizationId}
            communityIds={ctx.communityIds}
            end={ctx.dateRange.end}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function topN(rows: BarDatum[], n: number) {
  return rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function KpiCard({
  label,
  value,
  display,
  note,
  compare,
  invertDelta,
}: {
  label: string;
  value: number | null;
  display?: string;
  note: string;
  compare?: { previous: number; label: string } | undefined;
  invertDelta?: boolean | undefined;
}) {
  const delta = compare && value != null ? value - compare.previous : null;
  const good = delta == null || delta === 0 ? null : invertDelta ? delta < 0 : delta > 0;
  const relative =
    compare && compare.previous > 0 && delta != null ? `${Math.round((delta / compare.previous) * 100)}%` : null;

  return (
    <div className="kpi-card space-y-2 p-5">
      <p className="eyebrow">{label}</p>
      {value == null ? (
        <p className="font-display text-lg font-medium text-muted-foreground">Not configured</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="font-display text-2xl font-semibold tracking-tight text-brand">
            {display ?? value.toLocaleString()}
          </p>
          {delta != null ? (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive"
              }`}
              title={`${compare!.label}: ${compare!.previous.toLocaleString()}`}
            >
              {delta === 0 ? (
                <ArrowRight className="size-3" />
              ) : delta > 0 ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {delta > 0 ? "+" : ""}
              {delta.toLocaleString()}
              {relative ? ` (${delta > 0 ? "+" : ""}${relative})` : ""}
            </span>
          ) : null}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
      {compare ? (
        <p className="text-[11px] text-muted-foreground">
          {compare.label}: {compare.previous.toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Executive operational summary strip for the Funnel tab — mirrors the
 * information hierarchy of the WelcomeHome Overview (occupancy → move-ins →
 * move-outs → net → tours → tour-to-MI ratio) using ClarityIQ's own design
 * system. Every value is passed in from the canonical summary; no metric is
 * recalculated or redefined here.
 *
 * Period semantics are mixed by design and disclosed inline: occupancy is
 * current state (snapshots are not yet used for historical occupancy), while
 * the five event metrics are the selected reporting period.
 *
 * Tour to MI ratio is intentionally withheld: the exact WelcomeHome Overview
 * definition (move-ins/tours, tours/move-ins, or a cohort conversion) has not
 * been reconciled, so no percentage is fabricated.
 */
function ExecutiveSummaryStrip({
  occupancy,
  budgetUnits,
  moveIns,
  moveOuts,
  tours,
  periodLabel,
  occupancyComparison,
}: {
  occupancy: WhSalesSummary["occupancy"];
  budgetUnits: number | null;
  moveIns: number;
  moveOuts: number;
  tours: number | null;
  periodLabel: string;
  /** Historical occupancy % for the comparison window, from the canonical resolver. */
  occupancyComparison?: { pct: number | null; label: string } | null;
}) {
  const { censusUnits, occupiedUnitsCandidate, noticeCount, pendingMoveIns } = occupancy;
  const actualPct = censusUnits ? (occupiedUnitsCandidate / censusUnits) * 100 : null;
  const display = actualPct == null ? "—" : `${Math.round(actualPct)}%`;

  // Canonical budget model (matches resolveBudget): budgeted occupied units
  // are the stored input; the budget % is derived against the census
  // denominator. No budget is ever fabricated.
  const budgetPct = budgetUnits != null && censusUnits ? (budgetUnits / censusUnits) * 100 : null;
  const variancePts = actualPct != null && budgetPct != null ? actualPct - budgetPct : null;
  const varianceUnits = budgetUnits != null ? occupiedUnitsCandidate - budgetUnits : null;

  const varianceTone =
    variancePts == null || variancePts === 0
      ? "text-muted-foreground"
      : variancePts > 0
        ? "text-success"
        : "text-destructive";
  const VarianceIcon =
    variancePts == null || variancePts === 0 ? ArrowRight : variancePts > 0 ? ArrowUpRight : ArrowDownRight;

  const net = moveIns - moveOuts;

  // Occupancy is a percentage: the honest comparison is percentage points,
  // never a relative percentage change.
  const occPts =
    occupancyComparison?.pct != null && actualPct != null
      ? actualPct - occupancyComparison.pct
      : null;

  const metrics: { label: string; value: string; sub: string }[] = [
    { label: "Move-ins (EOM)", value: moveIns.toLocaleString(), sub: "Selected period" },
    { label: "Move-outs", value: moveOuts.toLocaleString(), sub: "Selected period" },
    {
      label: "Net MI/MO",
      value: `${net > 0 ? "+" : ""}${net.toLocaleString()}`,
      sub: "Move-ins − move-outs",
    },
    {
      label: "Tours",
      value: tours == null ? "—" : tours.toLocaleString(),
      sub: tours == null ? "No activity type mapped to Tour" : "Successful tours, period",
    },
    {
      label: "Tour to MI ratio",
      value: "—",
      sub: "Provisional — WelcomeHome definition not reconciled",
    },
  ];

  return (
    <section className="panel overflow-hidden bg-(--clarity-primary-soft)">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--clarity-border) px-5 py-3">
        <p className="eyebrow">Executive summary</p>
        <span className="rounded-full border border-(--clarity-border) bg-(--color-surface) px-2 py-0.5 text-[11px] font-medium text-(--clarity-primary)">
          Occupancy: current state · Activity: {periodLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-(--clarity-border) sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
        <div className="p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Occupancy %
          </p>
          <p className="font-display text-4xl font-semibold tracking-tight text-brand">{display}</p>
          {occPts != null ? (
            <p
              className={cn(
                "text-xs font-medium",
                occPts > 0 ? "text-success" : occPts < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {occPts > 0 ? "+" : ""}
              {occPts.toFixed(1)} pts {occupancyComparison?.label}
            </p>
          ) : occupancyComparison ? (
            <p className="text-xs text-muted-foreground">
              No stored history for the comparison period
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">Current state</p>
        </div>
        {metrics.map((m) => (
          <div key={m.label} className="p-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {m.label}
            </p>
            <p className="font-display text-2xl font-semibold tracking-tight">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.sub}</p>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-(--clarity-border) bg-(--color-surface) px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Occupied / census units
          </dt>
          <dd className="font-medium">
            {occupiedUnitsCandidate.toLocaleString()} / {censusUnits.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Budgeted occupancy
          </dt>
          <dd className="font-medium">
            {budgetPct != null ? `${budgetPct.toFixed(1)}%` : "Budget not set"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Variance to budget
          </dt>
          <dd className={cn("inline-flex flex-wrap items-center gap-1 font-medium", varianceTone)}>
            {variancePts == null ? (
              "—"
            ) : (
              <>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <VarianceIcon className="size-3.5" aria-hidden />
                  {variancePts > 0 ? "+" : ""}
                  {variancePts.toFixed(1)} pts
                </span>
                {varianceUnits != null ? (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    ({varianceUnits > 0 ? "+" : ""}
                    {varianceUnits.toLocaleString()} units)
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            On notice
          </dt>
          <dd className="font-medium">{noticeCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Pending move-ins
          </dt>
          <dd className="font-medium">{pendingMoveIns.toLocaleString()}</dd>
        </div>
      </dl>

      <p className="border-t border-(--clarity-border) bg-(--color-surface) px-5 pb-4 text-[11px] text-muted-foreground">
        Occupancy is current state and not affected by the selected date range; historical occupancy
        requires daily snapshots. Move-ins, move-outs, net and tours use the selected reporting
        period. Full unit diagnostics live on the Current occupancy tab.
      </p>
    </section>
  );
}


const TREND_STORAGE_KEY = "clarityiq.chart.sales-activity-trend";
const MOVE_TREND_STORAGE_KEY = "clarityiq.chart.move-trend";

const TREND_SERIES = [
  { key: "inquiries", label: "New inquiries", color: CHART_TOKENS.primary },
  { key: "tours", label: "Completed tours", color: CHART_TOKENS.secondary },
  { key: "re_tours", label: "Re-tours", color: "var(--chart-4)" },
  { key: "deposits", label: "Deposits", color: CHART_TOKENS.provisional, provisional: true },
  { key: "move_ins", label: "Move-ins", color: CHART_TOKENS.tertiary },
  { key: "move_outs", label: "Move-outs", color: CHART_TOKENS.quaternary },
  { key: "net_move_ins", label: "Net move-ins", color: "var(--chart-5)" },
];
const TREND_DEFAULTS = ["inquiries", "tours", "move_ins"];

function SalesTrendCard({ data, loading }: { data: Record<string, any>[]; loading: boolean }) {
  const { visible, toggle } = useSeriesVisibility(
    TREND_STORAGE_KEY,
    TREND_SERIES.map((s) => s.key),
    TREND_DEFAULTS,
  );
  const series = TREND_SERIES.filter((s) => visible.includes(s.key)).map((s) => ({
    key: s.key,
    label: s.provisional ? "Deposits (provisional)" : s.label,
    color: s.color,
    dashed: s.key === "deposits",
  }));

  return (
    <ChartCard
      title="Sales activity trend"
      description="Monthly period-event totals for the last 12 months, ending with the selected period. One bounded server-side aggregate produces every series using the validated metric predicates. Toggle series to inspect smaller-volume metrics."
      loading={loading}
      empty={!loading && data.length === 0 ? "No monthly data available for this selection." : undefined}
      height={320}
      actions={<SeriesToggleChips series={TREND_SERIES} visible={visible} onToggle={toggle} />}
    >
      <MetricTrendChart data={data} series={series} />
    </ChartCard>
  );
}

const MOVE_TREND_SERIES = [
  { key: "move_ins", label: "Move-ins", color: CHART_TOKENS.primary },
  { key: "move_outs", label: "Move-outs", color: CHART_TOKENS.quaternary },
  { key: "net_move_ins", label: "Net move-ins", color: CHART_TOKENS.tertiary },
];

function MoveTrendCard({ data, loading }: { data: Record<string, any>[]; loading: boolean }) {
  const { visible, toggle } = useSeriesVisibility(
    MOVE_TREND_STORAGE_KEY,
    MOVE_TREND_SERIES.map((s) => s.key),
    MOVE_TREND_SERIES.map((s) => s.key),
  );
  const bars = MOVE_TREND_SERIES.filter(
    (s) => visible.includes(s.key) && s.key !== "net_move_ins",
  );
  const line = visible.includes("net_move_ins")
    ? MOVE_TREND_SERIES.find((s) => s.key === "net_move_ins")
    : undefined;

  return (
    <ChartCard
      title="Move-in / move-out trend"
      description="Monthly census momentum for the last 12 months, using the validated financial move-in and move-out definitions. Net move-ins is drawn from the same aggregate."
      loading={loading}
      empty={!loading && data.length === 0 ? "No monthly data available." : undefined}
      height={300}
      actions={<SeriesToggleChips series={MOVE_TREND_SERIES} visible={visible} onToggle={toggle} />}
    >
      <GroupedBarChart
        data={data}
        bars={bars}
        line={line && bars.length > 0 ? line : undefined}
        xKey="label"
      />
    </ChartCard>
  );
}

function AttentionBar({
  label,
  value,
  total,
  withheldNote,
}: {
  label: string;
  value: number | null;
  total: number;
  withheldNote?: string;
}) {
  if (value == null) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{withheldNote ?? "Not available."}</p>
      </div>
    );
  }
  const width = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-display text-sm font-semibold tabular-nums text-foreground">{value}</span>
          {total > 0 ? ` · ${width.toFixed(0)}% of open pipeline` : ""}
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted">
        <div className="h-2.5 rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** Semantic activity mix from the wh_activity_mix server aggregate. */
function ActivityMixCard() {
  const ctx = useWhContext();
  const q = useWhActivityMix(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
  );
  const rows = q.data ?? [];
  const main = rows
    .filter((r) => r.category !== "unmapped" && r.activities > 0)
    .map((r) => ({
      label: WH_ACTIVITY_CATEGORY_LABELS[r.category as WhActivityCategory] ?? r.category,
      value: r.activities,
    }))
    .sort((a, b) => b.value - a.value);
  const unmapped = rows.find((r) => r.category === "unmapped")?.activities ?? 0;

  return (
    <ChartCard
      title="Sales activity mix"
      description="Completed activities in the selected period, grouped by the semantic category configured in WelcomeHome Mapping. Unmapped activity types are reported separately rather than folded into a category."
      loading={q.isLoading}
      empty={!q.isLoading && main.length === 0 ? "No mapped activities in this period." : undefined}
      height={Math.max(220, main.length * 32 + 50)}
      actions={
        unmapped > 0 ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {unmapped.toLocaleString()} unmapped activities
          </span>
        ) : null
      }
    >
      <HorizontalBarChart data={main} valueLabel="Activities" color={CHART_TOKENS.secondary} labelWidth={110} />
    </ChartCard>
  );
}

function CounselorChart({
  title,
  description,
  rows,
  valueLabel,
  color,
}: {
  title: string;
  description: string;
  rows: BarDatum[];
  valueLabel: string;
  color?: string | undefined;
}) {
  const data = topN(rows, 8);
  return (
    <ChartCard
      title={title}
      description={description}
      empty={data.length === 0 ? "Nothing recorded for this selection." : undefined}
      height={Math.max(200, data.length * 30 + 50)}
    >
      <HorizontalBarChart data={data} valueLabel={valueLabel} color={color} labelWidth={120} />
    </ChartCard>
  );
}

/**
 * Lead source mix.
 *
 * Volume and share only: inquiries and move-ins per lead source, exactly as
 * wh_sales_summary already groups them by the prospect's recorded WelcomeHome
 * lead source. Nothing is inferred, merged by name similarity or attributed
 * from another system, and no conversion rate is computed here — the
 * inquiry-to-move-in ratio moved out of this tab.
 *
 * Shares are always taken against the period/community totals in scope, not
 * against the visible slice of rows.
 */
type LeadSourceRow = { id: string; label: string; inquiries: number; tours: number; moveIns: number };
type SourceSortKey =
  | "label"
  | "inquiries"
  | "inquiryShare"
  | "tours"
  | "tourShare"
  | "moveIns"
  | "moveInShare";
const SOURCE_LIMITS = [
  { value: 5, label: "Top 5" },
  { value: 10, label: "Top 10" },
  { value: 0, label: "All" },
] as const;

function LeadSourceMix({
  rows,
  totals,
  reTours,
  prior,
  comparisonLabel,
  utm,
}: {
  rows: LeadSourceRow[];
  totals: { inquiries: number; tours: number; moveIns: number };
  reTours: number;
  prior: { inquiries: number; tours: number; moveIns: number } | null;
  comparisonLabel: string;
  utm: { total: number; counts: Record<string, number> };
}) {
  const [sort, setSort] = useState<{ key: SourceSortKey; dir: "asc" | "desc" }>({
    key: "inquiries",
    dir: "desc",
  });
  const [limit, setLimit] = useState<number>(10);

  // Attributed sums can trail the scope totals when a prospect carries no lead
  // source. Percentages use the scope total so they never overstate a source.
  const attributed = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          inquiries: acc.inquiries + r.inquiries,
          tours: acc.tours + r.tours,
          moveIns: acc.moveIns + r.moveIns,
        }),
        { inquiries: 0, tours: 0, moveIns: 0 },
      ),
    [rows],
  );

  const sorted = useMemo(() => {
    const share = (n: number, d: number) => (d > 0 ? n / d : 0);
    const value = (r: LeadSourceRow): string | number => {
      switch (sort.key) {
        case "label":
          return r.label.toLowerCase();
        case "inquiries":
          return r.inquiries;
        case "inquiryShare":
          return share(r.inquiries, totals.inquiries);
        case "tours":
          return r.tours;
        case "tourShare":
          return share(r.tours, totals.tours);
        case "moveIns":
          return r.moveIns;
        case "moveInShare":
          return share(r.moveIns, totals.moveIns);
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return a.label.localeCompare(b.label);
      return (av > bv ? 1 : -1) * dir;
    });
  }, [rows, sort, totals]);

  const visible = limit > 0 ? sorted.slice(0, limit) : sorted;
  const hiddenCount = sorted.length - visible.length;

  const toggleSort = (key: SourceSortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "label" ? "asc" : "desc" },
    );

  const sortButton = (key: SourceSortKey, label: string, align: "left" | "right" = "right") => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium",
        align === "right" ? "justify-end" : "justify-start",
      )}
    >
      {label}
      <span className={cn("text-[10px]", sort.key === key ? "opacity-80" : "opacity-0")}>
        {sort.dir === "desc" ? "▼" : "▲"}
      </span>
    </button>
  );

  const sharePct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
  const changePct = (current: number, previous: number) =>
    previous > 0 ? ((current - previous) / previous) * 100 : null;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <SourceTotalCard
          label="Inquiries in period"
          value={totals.inquiries}
          attributed={attributed.inquiries}
          change={prior ? changePct(totals.inquiries, prior.inquiries) : null}
          comparisonLabel={comparisonLabel}
        />
        <SourceTotalCard
          label="Move-ins in period"
          value={totals.moveIns}
          attributed={attributed.moveIns}
          change={prior ? changePct(totals.moveIns, prior.moveIns) : null}
          comparisonLabel={comparisonLabel}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Inquiries by lead source"
          description="Countable prospects created in the selected period, grouped by the lead source recorded in WelcomeHome. Share is of all inquiries in scope."
          empty={attributed.inquiries === 0 ? "No lead source data for this selection." : undefined}
          height={Math.max(220, Math.min(rows.length, 10) * 30 + 50)}
        >
          <HorizontalBarChart
            data={topN(rows.map((r) => ({ label: r.label, value: r.inquiries })), 10)}
            valueLabel="Inquiries"
            shareTotal={totals.inquiries}
          />
        </ChartCard>
        <ChartCard
          title="Move-ins by lead source"
          description="Counted move-ins in the period, attributed through the prospect's recorded lead source. Share is of all move-ins in scope."
          empty={attributed.moveIns === 0 ? "No attributed move-ins in this period." : undefined}
          height={Math.max(220, Math.min(rows.length, 10) * 30 + 50)}
        >
          <HorizontalBarChart
            data={topN(rows.map((r) => ({ label: r.label, value: r.moveIns })), 10)}
            valueLabel="Move-ins"
            color={CHART_TOKENS.tertiary}
            shareTotal={totals.moveIns}
          />
        </ChartCard>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Lead source mix</h2>
          <div className="flex items-center gap-1">
            {SOURCE_LIMITS.map((o) => (
              <Button
                key={o.label}
                size="sm"
                variant={limit === o.value ? "default" : "outline"}
                onClick={() => setLimit(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState title="No lead source data" />
        ) : (
          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="thead-brand hover:bg-brand-light">
                  <TableHead>{sortButton("label", "Lead source", "left")}</TableHead>
                  <TableHead className="text-right">{sortButton("inquiries", "Inquiries")}</TableHead>
                  <TableHead className="text-right">{sortButton("inquiryShare", "% of inquiries")}</TableHead>
                  <TableHead className="text-right">{sortButton("moveIns", "Move-ins")}</TableHead>
                  <TableHead className="text-right">{sortButton("moveInShare", "% of move-ins")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} className="odd:bg-brand-soft/60 hover:bg-brand-light/70">

                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.inquiries.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {sharePct(r.inquiries, totals.inquiries)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.moveIns.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {sharePct(r.moveIns, totals.moveIns)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {sorted.length} lead source{sorted.length === 1 ? "" : "s"} in scope
          {hiddenCount > 0 ? ` · ${hiddenCount} hidden by the current display limit` : ""} ·{" "}
          {attributed.inquiries.toLocaleString()} of {totals.inquiries.toLocaleString()} inquiries and{" "}
          {attributed.moveIns.toLocaleString()} of {totals.moveIns.toLocaleString()} move-ins carry a
          recorded lead source. Percentages are shares of the totals in scope, so an unrecorded
          source is never redistributed.
        </p>
      </section>

      <Accordion type="single" collapsible className="panel px-5">
        <AccordionItem value="utm">
          <AccordionTrigger className="text-sm">Digital metadata coverage (data readiness)</AccordionTrigger>
          <AccordionContent>
            <p className="pb-2 text-xs text-muted-foreground">
              How often UTM values arrive on prospect records. Cross-source attribution is a later
              phase; this is a readiness measurement only and does not affect the counts above.
            </p>
            <ul className="text-sm text-muted-foreground">
              {Object.entries(utm.counts).map(([k, v]) => (
                <li key={k}>
                  {k}: {v} of {utm.total} ({pct(ratio(Number(v), utm.total))})
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function SourceTotalCard({
  label,
  value,
  attributed,
  change,
  comparisonLabel,
  note,
}: {
  label: string;
  value: number;
  attributed: number;
  change: number | null;
  comparisonLabel: string;
  note?: string;
}) {
  const tone = change == null ? "neutral" : change > 0 ? "up" : change < 0 ? "down" : "neutral";
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : ArrowRight;
  return (
    <div className="kpi-card space-y-1.5 p-5">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight text-brand">
        {value.toLocaleString()}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {change == null ? (
          <span className="text-muted-foreground">No comparison</span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              tone === "up" && "text-success",
              tone === "down" && "text-destructive",
              tone === "neutral" && "text-muted-foreground",
            )}
            title={comparisonLabel}
          >
            <Icon className="size-3.5" />
            {change > 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        )}
        <span className="text-muted-foreground">
          {attributed.toLocaleString()} with a recorded source
        </span>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}


const BUCKETS: { value: WhProspectBucket; label: string }[] = [
  { value: "overdue", label: "Overdue next activity" },
  { value: "pipeline", label: "Open pipeline" },
  { value: "hot", label: "Hot leads" },
  { value: "hot_no_activity", label: "Hot, no future activity" },
  { value: "stalled", label: "Stalled" },
];

const PAGE_SIZE = 50;

/** Server-paginated record list. The full table is never sent to the browser. */
function ProspectDrillThrough() {
  const ctx = useWhContext();
  const labels = useWhLabelMaps(ctx.connectionId);
  const [bucket, setBucket] = useState<WhProspectBucket>("overdue");
  const [page, setPage] = useState(0);
  const q = useWhProspectPage(ctx.organizationId, bucket, ctx.communityIds, page, PAGE_SIZE);

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <Button
            key={b.value}
            size="sm"
            variant={bucket === b.value ? "default" : "outline"}
            onClick={() => {
              setBucket(b.value);
              setPage(0);
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>
      <DataTable
        columns={[
          { key: "name", header: "Prospect", render: (p: any) => personName(p.person_name) },
          { key: "com", header: "Community", render: (p: any) => ctx.communityNames[p.community_id ?? ""] ?? "—" },
          { key: "stage", header: "Stage", render: (p: any) => resolveLabel(labels.stage, p.stage_id, "Unknown stage") },
          { key: "score", header: "Score", render: (p: any) => resolveLabel(labels.score, p.score_id, "Unscored") },
          {
            key: "next",
            header: "Scheduled",
            render: (p: any) => <span className="text-xs">{p.next_activity_scheduled_at?.slice(0, 10) ?? "—"}</span>,
          },
          {
            key: "counselor",
            header: "Counselor",
            render: (p: any) => resolveLabel(labels.user, p.current_sales_counselor_id, "Unassigned"),
          },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No matching prospects" description="Nothing in this bucket for the current selection." />}
      />
      <Pager page={page} pages={pages} total={total} noun="prospects" onChange={setPage} />
    </section>
  );
}

function Pager({
  page,
  pages,
  total,
  noun,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  onChange: (updater: (p: number) => number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        {total.toLocaleString()} {noun} · page {page + 1} of {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onChange((p) => p - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onChange((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * Tour KPI drill-through (V-002). Server-paginated through wh_tour_page: the
 * default view lists exactly the successful tours behind the KPI, and the
 * diagnostic view lists every tour activity in the period. No prospect PII.
 */
function TourDrillThrough() {
  const ctx = useWhContext();
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"successful" | "all">("successful");
  const q = useWhTourPage(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
    mode,
    page,
    PAGE_SIZE,
  );
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          {mode === "successful"
            ? "Exactly the rows behind the Completed tours KPI: tour activities with a successful WelcomeHome result, completed in the selected period."
            : "Every completed tour activity in the period, including results WelcomeHome does not treat as successful."}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMode((m) => (m === "successful" ? "all" : "successful"));
            setPage(0);
          }}
        >
          {mode === "successful" ? "Show all tour activities" : "Show counted tours only"}
        </Button>
      </div>
      <DataTable
        columns={[
          { key: "name", header: "Prospect", render: (r: any) => personName(r.person_name) },
          { key: "com", header: "Community", render: (r: any) => ctx.communityNames[r.community_id ?? ""] ?? "—" },
          { key: "date", header: "Completed", render: (r: any) => r.completed_local_date ?? "—" },
          { key: "result", header: "Result", render: (r: any) => r.result_label ?? "—" },
          { key: "ok", header: "Counted", render: (r: any) => (r.successful ? "Yes" : "No") },
          {
            key: "seq",
            header: "Sequence",
            render: (r: any) => (r.first_completed_of_type ? "Initial" : "Repeat"),
          },
          { key: "type", header: "Activity type", render: (r: any) => r.activity_type_label ?? "Unlabeled activity" },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No tour activities" description="Nothing matches the current selection." />}
      />
      <Pager
        page={page}
        pages={pages}
        total={total}
        noun={mode === "successful" ? "counted tours" : "tour activities"}
        onChange={setPage}
      />
    </section>
  );
}

/**
 * Deposit KPI drill-through. Server-paginated through wh_deposit_page, which
 * applies the same V-003 filter as the KPI, so this list always reconciles to
 * the displayed Deposit count. No resident or prospect PII is returned.
 */
function DepositDrillThrough() {
  const ctx = useWhContext();
  const [page, setPage] = useState(0);
  const q = useWhDepositPage(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
    page,
    PAGE_SIZE,
  );
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <p className="max-w-2xl text-xs text-muted-foreground">
        Exactly the rows behind the Deposit candidate: transaction_type = Deposit and deposit_type =
        Deposit, dated in the selected period.
      </p>
      <DataTable
        columns={[
          { key: "name", header: "Depositor", render: (r: any) => personName(r.person_name) },
          { key: "com", header: "Community", render: (r: any) => ctx.communityNames[r.community_id ?? ""] ?? "—" },
          { key: "date", header: "Date", render: (r: any) => r.occurred_local_date ?? "—" },
          { key: "type", header: "Deposit type", render: (r: any) => r.deposit_type ?? "—" },
          {
            key: "amt",
            header: "Amount",
            align: "right",
            render: (r: any) => (r.amount == null ? "—" : Number(r.amount).toLocaleString()),
          },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No counted deposits" description="No standard deposit transactions in this selection." />}
      />
      <Pager page={page} pages={pages} total={total} noun="counted deposits" onChange={setPage} />
    </section>
  );
}

/** Neutral fallback so raw reference ids never surface as a person's name. */
function personName(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t.length ? t : "Name unavailable";
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="kpi-card space-y-1 p-5">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight text-brand">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/**
 * Unit reconciliation diagnostic: which WelcomeHome Unit records were removed
 * from the census denominator, and why. Computed server-side; no resident data.
 */
function UnitCensusDiagnostic({ totalUnits, inactive }: { totalUnits: number; inactive: number }) {
  const ctx = useWhContext();
  const q = useWhUnitCensusReport(ctx.organizationId, ctx.communityIds);
  const rows = q.data ?? [];

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Every Unit record held back from the census denominator, with the deterministic reason.
        {" "}
        {totalUnits.toLocaleString()} total unit records stored, {inactive.toLocaleString()}{" "}
        inactive/discarded. Nothing is deleted from the source.
      </p>
      <DataTable
        columns={[
          { key: "src", header: "Source ID", render: (r: any) => <code className="text-xs">{r.source_id}</code> },
          { key: "num", header: "Unit number", render: (r: any) => r.unit_number ?? "—" },
          { key: "fp", header: "Floor plan", render: (r: any) => r.floor_plan_label ?? "—" },
          {
            key: "why",
            header: "Exclusion reason",
            render: (r: any) => UNIT_EXCLUSION_LABELS[r.exclusion_reason] ?? r.exclusion_reason,
          },
        ]}
        rows={rows as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No units excluded" description="Every unit record is census-eligible." />}
      />
    </section>
  );
}

/**
 * Move-In KPI drill-through (V-004). Server-paginated through wh_move_in_page,
 * which applies exactly the KPI predicates (count_move_in true, financial
 * move-in date inside the selected period, lease not canceled) under the same
 * organization and community authorization. The diagnostic mode lists in-period
 * contracts the source marks non-countable (Transfer Ins). No resident PII.
 */
function MoveInDrillThrough() {
  const ctx = useWhContext();
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"move_in" | "transfer_in">("move_in");
  const q = useWhMoveInPage(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
    mode,
    page,
    PAGE_SIZE,
  );
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          {mode === "move_in"
            ? "Exactly the rows behind the Move-in KPI: count_move_in contracts with a financial move-in date in the selected period, canceled leases excluded."
            : "In-period contracts the source marks count_move_in = false — typically Transfer Ins. Shown for audit only; never counted."}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMode((m) => (m === "move_in" ? "transfer_in" : "move_in"));
            setPage(0);
          }}
        >
          {mode === "move_in" ? "Show excluded / transfer records" : "Show counted move-ins only"}
        </Button>
      </div>
      <DataTable
        columns={[
          { key: "name", header: "Resident", render: (r: any) => personName(r.person_name) },
          { key: "com", header: "Community", render: (r: any) => ctx.communityNames[r.community_id ?? ""] ?? "—" },
          { key: "date", header: "Financial move-in", render: (r: any) => r.financial_move_in_date ?? "—" },
          { key: "unit", header: "Unit", render: (r: any) => r.unit_label ?? "Unassigned unit" },
          { key: "care", header: "Care type", render: (r: any) => r.care_type ?? "Unspecified" },
          { key: "status", header: "Status", render: (r: any) => r.status ?? "—" },
          { key: "counted", header: "Counted", render: () => (mode === "move_in" ? "Yes" : "No") },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={
          <EmptyState
            title={mode === "move_in" ? "No counted move-ins" : "No excluded move-in records"}
            description="Nothing matches the current selection."
          />
        }
      />
      <Pager
        page={page}
        pages={pages}
        total={total}
        noun={mode === "move_in" ? "counted move-ins" : "excluded records"}
        onChange={setPage}
      />
    </section>
  );
}
