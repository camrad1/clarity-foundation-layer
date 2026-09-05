import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Minus,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { CHART_TOKENS, ChartCard, MetricTrendChart } from "@/components/clarity/charts";
import { SeriesToggleChips, useSeriesVisibility } from "@/components/clarity/series-toggle";

import { useWhContext } from "@/lib/wh/use-wh";
import { useAppState } from "@/state/app-state";
import { useWhSalesSummary } from "@/lib/wh/summary";
import { useOccupancyWithBudget } from "@/lib/wh/occupancy";
import { useOccupancyTrend } from "@/lib/wh/snapshots";
import { useSearchDailyTotals } from "@/lib/gsc/api-queries";
import { GA4_SOURCE_LABEL, useGa4Health, useGa4Totals } from "@/lib/google/ga4-queries";
import {
  EVIDENCE_LABELS,
  EVIDENCE_VERBS,
  grainForPeriod,
  ratePct,
  useCommunityVisibility,
  useJourneyFurther,
  useJourneyMatrix,
  useJourneySeries,
  type EvidenceLevel,
  type JourneyCommunityRow,
} from "@/lib/journey/queries";
import { comparisonSuffix, formatDateOnly, formatPeriodLabel, type Period } from "@/lib/date-ranges";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/journey")({
  head: () => ({
    meta: [
      { title: "Performance Journey — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "From search visibility through traffic, conversations, leads, tours, deposits and move-ins to occupancy, with the evidence behind every link stated plainly.",
      },
      { property: "og:title", content: "Performance Journey — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Visibility to occupancy, connected stage by stage with declared attribution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PerformanceJourney,
});

/* ------------------------------------------------------------------ utils */

const nf = new Intl.NumberFormat("en-US");
const fmt = (v: number | null | undefined) => (v == null ? "—" : nf.format(Math.round(v)));
/** Pending reads read "Loading…" instead of an em dash, which means "no data". */
const show = (loading: boolean, text: string) => (loading ? "Loading…" : text);
const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v.toFixed(digits)}%`;
const fmtPos = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

function priorPeriod(start: string, end: string): Period {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  const pe = new Date(s.getTime() - 86400000);
  const ps = new Date(pe.getTime() - (days - 1) * 86400000);
  return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
}

type Delta = { label: string; tone: "up" | "down" | "neutral" } | null;

/** Relative change; lower-is-better metrics (average position) invert the tone. */
function delta(current: number | null | undefined, prior: number | null | undefined, opts?: {
  lowerIsBetter?: boolean;
  points?: boolean;
}): Delta {
  if (current == null || prior == null) return null;
  if (opts?.points) {
    const d = current - prior;
    if (Math.abs(d) < 0.05) return { label: "No change", tone: "neutral" };
    const better = opts.lowerIsBetter ? d < 0 : d > 0;
    return { label: `${d > 0 ? "+" : ""}${d.toFixed(1)} pts`, tone: better ? "up" : "down" };
  }
  if (!prior) return current ? { label: "New", tone: "up" } : null;
  const pct = ((current - prior) / prior) * 100;
  if (Math.abs(pct) < 0.5) return { label: "No change", tone: "neutral" };
  const better = opts?.lowerIsBetter ? pct < 0 : pct > 0;
  return { label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, tone: better ? "up" : "down" };
}

/* ------------------------------------------------------------- stage card */

type Stage = {
  key: string;
  name: string;
  metric: string;
  value: string;
  loading?: boolean;
  delta: Delta;
  priorLabel: string;
  source: string;
  freshness: string;
  scope: string;
  support?: string | undefined;
  href?: { to: string } | undefined;
};

function DeltaChip({ delta, priorLabel }: { delta: Delta; priorLabel: string }) {
  const Icon = delta?.tone === "up" ? ArrowUpRight : delta?.tone === "down" ? ArrowDownRight : Minus;
  if (!delta) return <span className="text-xs text-muted-foreground">No comparison</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        delta.tone === "up" && "text-success",
        delta.tone === "down" && "text-destructive",
        delta.tone === "neutral" && "text-muted-foreground",
      )}
      title={priorLabel}
    >
      <Icon className="size-3.5" />
      {delta.label}
    </span>
  );
}

/**
 * One stage of the journey. Provenance stays on the card but is tucked into a
 * compact disclosure so the metric, its change and its supporting figure lead
 * the hierarchy.
 */
function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const body = (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-4">
      <p className="eyebrow">
        {index + 1}. {stage.name}
      </p>
      <p className="text-xs text-muted-foreground">{stage.metric}</p>
      {stage.loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="font-display text-2xl font-semibold tracking-tight text-brand">
          {stage.value}
        </p>
      )}
      {stage.loading ? (
        <Skeleton className="h-4 w-32" />
      ) : (
        <DeltaChip delta={stage.delta} priorLabel={stage.priorLabel} />
      )}
      {stage.support && !stage.loading ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{stage.support}</p>
      ) : null}
      <details className="group mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <span className="truncate">{stage.freshness}</span>
          <ChevronDown className="size-3 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-0.5 pt-1">
          <p>{stage.source}</p>
          <p>{stage.scope}</p>
        </div>
      </details>
    </div>
  );
  return stage.href ? (
    <Link to={stage.href.to} className="block h-full focus:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Subtle directional connector shown between stage cards on wide layouts. */
function StageConnector() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 sm:block"
    >
      <ArrowRight className="size-4 text-brand/40" />
    </div>
  );
}

/* -------------------------------------------------------------- evidence  */

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  const tone =
    level === 1
      ? "bg-success/10 text-success"
      : level === 2
        ? "bg-info/10 text-info"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      {EVIDENCE_LABELS[level]}
    </span>
  );
}

type Transition = {
  key: string;
  from: string;
  to: string;
  level: EvidenceLevel;
  rate: number | null;
  rateLabel: string;
  sentence: string;
  note: string;
  highlight?: boolean;
  loading?: boolean;
};

/**
 * Compact transition row. The full evidence wording is preserved verbatim but
 * moves behind a disclosure so the section reads as a chain, not a report.
 */
function TransitionRow({ t }: { t: Transition }) {
  return (
    <details
      className={cn(
        "group panel px-4 py-3",
        t.highlight && "border-success/40 bg-success/[0.04]",
      )}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-[13rem] items-center gap-2 text-sm font-medium text-foreground">
          {t.from}
          <ArrowRight className="size-3.5 text-muted-foreground" />
          {t.to}
        </span>
        {t.loading ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <span className="flex flex-1 flex-wrap items-baseline gap-2">
            <span className="font-display text-lg font-semibold text-brand">
              {t.rate == null ? "—" : fmtPct(t.rate)}
            </span>
            <span className="text-xs text-muted-foreground">{t.rateLabel}</span>
          </span>
        )}
        <EvidenceBadge level={t.level} />
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1 pt-2 text-xs leading-relaxed text-muted-foreground">
        <p>{t.sentence}</p>
        <p className="text-[11px]">{t.note}</p>
      </div>
    </details>
  );
}


/* ------------------------------------------------------------------- page */

/**
 * Performance Journey.
 *
 * Every number is read from the canonical layer that already owns it: Search
 * Console API for visibility, GA4 API for traffic, the Further lead layer and
 * its active exact-ID matches for conversations, wh_sales_summary for leads,
 * tours, deposits and move-ins, and the canonical occupancy resolver (with the
 * community-specific capacity basis) for occupancy. Nothing is recalculated
 * here, and each transition states the strength of its own evidence.
 */
function PerformanceJourney() {
  const ctx = useWhContext();
  const scopeMode = useAppState().communityScope.mode;
  const period: Period = { start: ctx.dateRange.start, end: ctx.dateRange.end };
  const prior = ctx.comparisonRange ?? priorPeriod(period.start, period.end);
  const priorLabel = ctx.comparisonRange
    ? comparisonSuffix(ctx.comparisonMode)
    : "vs prior equal-length period";

  const singleCommunity = ctx.communityIds.length === 1 ? ctx.communityIds[0]! : null;
  const scopeLabel =
    ctx.communityIds.length === 1
      ? (ctx.communityNames[singleCommunity!] ?? "Selected community")
      : scopeMode === "all"
        ? `All authorized communities (${ctx.communityIds.length})`
        : `${ctx.communityIds.length} communities`;


  // The eight stages read from eight different canonical layers, several of
  // which are heavy portfolio aggregates. They are released in waves rather
  // than fired together, so a wide range (year to date, all communities) does
  // not saturate the database connection and time out.
  const wh = useWhSalesSummary(ctx.organizationId, ctx.communityIds, period.start, period.end);
  // wh_sales_summary is the single heaviest read on the page; it runs alone
  // first so the lighter source reads never compete with it.
  const w2 = wh.isFetched || wh.isError;

  // Visibility — Search Console API (property-wide) or the deterministic
  // page-mapping rules when exactly one community is selected.
  const searchNow = useSearchDailyTotals(
    ctx.organizationId,
    !w2 || singleCommunity ? null : period,
  );
  const commSearchNow = useCommunityVisibility(
    ctx.organizationId,
    w2 ? singleCommunity : null,
    period,
  );

  // Traffic — GA4 API. Portfolio uses property-wide totals; a community scope
  // uses only mapped landing pages. Partial current days are excluded.
  const ga4Now = useGa4Totals(ctx.organizationId, w2 ? period : null, ctx.communityIds);

  // Conversations — Further leads and their active exact-ID matches.
  const furtherNow = useJourneyFurther(
    ctx.organizationId,
    ctx.communityIds,
    w2 ? period : null,
  );

  // Comparison wave.
  const whPrior = useWhSalesSummary(
    ctx.organizationId,
    ctx.communityIds,
    prior.start,
    prior.end,
    w2,
  );

  const currentDone =
    w2 &&
    (whPrior.isFetched || whPrior.isError) &&
    (singleCommunity ? commSearchNow.isFetched || commSearchNow.isError : searchNow.data !== undefined || !searchNow.isLoading) &&
    (ga4Now.isFetched || ga4Now.isError) &&
    (furtherNow.isFetched || furtherNow.isError);

  const searchPrior = useSearchDailyTotals(
    ctx.organizationId,
    currentDone && !singleCommunity ? prior : null,
  );
  const commSearchPrior = useCommunityVisibility(
    ctx.organizationId,
    currentDone ? singleCommunity : null,
    prior,
  );
  const ga4Prior = useGa4Totals(ctx.organizationId, currentDone ? prior : null, ctx.communityIds);
  const furtherPrior = useJourneyFurther(
    ctx.organizationId,
    ctx.communityIds,
    currentDone ? prior : null,
  );

  const priorDone = currentDone && (whPrior.isFetched || whPrior.isError);

  const vis = singleCommunity
    ? {
        clicks: commSearchNow.data?.clicks ?? null,
        impressions: commSearchNow.data?.impressions ?? null,
        ctr: commSearchNow.data?.ctr ?? null,
        position: commSearchNow.data?.position ?? null,
      }
    : {
        clicks: (searchNow.data?.clicks as number | undefined) ?? null,
        impressions: (searchNow.data?.impressions as number | undefined) ?? null,
        ctr: (searchNow.data?.ctr as number | null | undefined) ?? null,
        position: (searchNow.data?.avg_position as number | null | undefined) ?? null,
      };
  const visPrior = singleCommunity
    ? {
        clicks: commSearchPrior.data?.clicks ?? null,
        impressions: commSearchPrior.data?.impressions ?? null,
        ctr: commSearchPrior.data?.ctr ?? null,
        position: commSearchPrior.data?.position ?? null,
      }
    : {
        clicks: (searchPrior.data?.clicks as number | undefined) ?? null,
        impressions: (searchPrior.data?.impressions as number | undefined) ?? null,
        ctr: (searchPrior.data?.ctr as number | null | undefined) ?? null,
        position: (searchPrior.data?.avg_position as number | null | undefined) ?? null,
      };

  // Occupancy — canonical current state with the community capacity basis.
  const { occupancy } = useOccupancyWithBudget(
    priorDone ? ctx.organizationId : null,
    ctx.communityIds,
  );
  const priorOcc = useOccupancyTrend(
    priorDone ? ctx.organizationId : null,
    ctx.communityIds,
    prior.start,
    prior.end,
    "daily",
  );
  const ga4Health = useGa4Health(priorDone ? ctx.organizationId : null);

  const occDone = priorDone;

  const grain = grainForPeriod(period);
  const series = useJourneySeries(
    ctx.organizationId,
    ctx.communityIds,
    occDone ? period : null,
    grain,
  );
  const matrix = useJourneyMatrix(
    ctx.organizationId,
    ctx.communityIds,
    series.isFetched || series.isError ? period : null,
  );


  const visLoading = singleCommunity ? commSearchNow.isLoading : searchNow.isLoading;
  const occTotals = occupancy.data?.totals;
  const priorOccPct = useMemo(() => {
    const pts = priorOcc.data ?? [];
    const last = pts[pts.length - 1];
    return last?.occupancy_pct == null ? null : Number(last.occupancy_pct) * 100;
  }, [priorOcc.data]);

  const searchSource = singleCommunity
    ? "Source: Search Console API · mapped pages only"
    : searchNow.source === "manual"
      ? "Source: Manual Search Console import"
      : "Source: Search Console API";
  const searchFresh = singleCommunity
    ? formatPeriodLabel(period)
    : searchNow.data?.last_date
      ? `Through ${formatDateOnly(searchNow.data.last_date)}`
      : "No data for this range";

  const ga4Fresh = ga4Health.data?.last_complete_date
    ? `Through ${formatDateOnly(ga4Health.data.last_complete_date)}`
    : "No complete GA4 day yet";

  const stages: Stage[] = [
    {
      key: "visibility",
      name: "Visibility",
      metric: "Search clicks",
      value: fmt(vis.clicks),
      loading: visLoading,
      delta: delta(vis.clicks, visPrior.clicks),
      priorLabel,
      source: searchSource,
      freshness: searchFresh,
      scope: singleCommunity ? `${scopeLabel} (mapped pages)` : "Property-wide",
      support: `${fmt(vis.impressions)} impressions · CTR ${
        vis.ctr == null ? "—" : fmtPct(vis.ctr * 100, 2)
      } · avg position ${fmtPos(vis.position)}`,
      href: { to: "/marketing" },
    },
    {
      key: "traffic",
      name: "Traffic",
      metric: "Website sessions",
      value: fmt(ga4Now.data?.sessions),
      loading: ga4Now.isLoading,
      delta: delta(ga4Now.data?.sessions ?? null, ga4Prior.data?.sessions ?? null),
      priorLabel,
      source: GA4_SOURCE_LABEL,
      freshness: ga4Fresh,
      scope: ctx.communityIds.length ? `${scopeLabel} (mapped landing pages)` : "Property-wide",
      support: `${fmt(ga4Now.data?.active_users)} active users · ${fmt(
        ga4Now.data?.new_users,
      )} new · engagement ${
        ga4Now.data?.engagement_rate == null ? "—" : fmtPct(ga4Now.data.engagement_rate * 100)
      }`,
    },
    {
      key: "conversations",
      name: "Conversations",
      metric: "Further leads",
      value: fmt(furtherNow.data?.leads),
      loading: furtherNow.isLoading,
      delta: delta(furtherNow.data?.leads ?? null, furtherPrior.data?.leads ?? null),
      priorLabel,
      source: "Source: Further API",
      freshness: furtherNow.data?.last_lead
        ? `Latest lead ${formatDateOnly(furtherNow.data.last_lead)}`
        : "No leads in this range",
      scope: scopeLabel,
      support: `${fmt(furtherNow.data?.matched)} matched to WelcomeHome · ${fmt(
        furtherNow.data?.tour_scheduled,
      )} tour requests`,
    },
    {
      key: "leads",
      name: "Leads",
      metric: "New inquiries",
      value: fmt(wh.data?.inquiries),
      loading: wh.isLoading,
      delta: delta(wh.data?.inquiries ?? null, whPrior.data?.inquiries ?? null),
      priorLabel,
      source: "Source: WelcomeHome CRM",
      freshness: formatPeriodLabel(period),
      scope: scopeLabel,
      href: { to: "/sales" },
    },
    {
      key: "tours",
      name: "Tours",
      metric: "Completed tours",
      value: fmt(wh.data?.tours),
      loading: wh.isLoading,
      delta: delta(wh.data?.tours ?? null, whPrior.data?.tours ?? null),
      priorLabel,
      source: "Source: WelcomeHome CRM",
      freshness: formatPeriodLabel(period),
      scope: scopeLabel,
      support: `${fmt(wh.data?.reTours)} of these are re-tours`,
      href: { to: "/sales" },
    },
    {
      key: "deposits",
      name: "Deposits",
      metric: "Depositors",
      value: fmt(wh.data?.deposits),
      loading: wh.isLoading,
      delta: delta(wh.data?.deposits ?? null, whPrior.data?.deposits ?? null),
      priorLabel,
      source: "Source: WelcomeHome CRM · provisional",
      freshness: formatPeriodLabel(period),
      scope: scopeLabel,
      href: { to: "/sales" },
    },
    {
      key: "move_ins",
      name: "Move-Ins",
      metric: "Move-ins",
      value: fmt(wh.data?.moveIns),
      loading: wh.isLoading,
      delta: delta(wh.data?.moveIns ?? null, whPrior.data?.moveIns ?? null),
      priorLabel,
      source: "Source: WelcomeHome CRM",
      freshness: formatPeriodLabel(period),
      scope: scopeLabel,
      support: `${fmt(wh.data?.moveOuts)} move-outs · net ${
        wh.data ? fmt(wh.data.moveIns - wh.data.moveOuts) : "—"
      }`,
      href: { to: "/sales" },
    },
    {
      key: "occupancy",
      name: "Occupancy",
      metric: "Current occupancy",
      value: occTotals?.occupancyPct == null ? "—" : fmtPct(occTotals.occupancyPct * 100),
      loading: occupancy.isLoading || !occDone,
      delta: delta(
        occTotals?.occupancyPct == null ? null : occTotals.occupancyPct * 100,
        priorOccPct,
        { points: true },
      ),
      priorLabel: ctx.comparisonRange ? priorLabel : "no comparison period selected",
      source: "Source: Canonical occupancy layer",
      freshness: occupancy.data?.asOf ? `As of ${formatDateOnly(occupancy.data.asOf)}` : "—",
      scope: `${scopeLabel} · community capacity basis`,
      support: occTotals
        ? `${fmt(occTotals.occupiedCapacity || occTotals.occupiedUnits)} of ${fmt(
            occTotals.censusCapacity || occTotals.censusUnits,
          )} capacity`
        : undefined,
      href: { to: "/occupancy" },
    },
  ];

  const f = furtherNow.data;
  const transitions: Transition[] = [
    {
      key: "vis_traffic",
      from: "Visibility",
      to: "Traffic",
      level: 3,
      rate: ratePct(ga4Now.data?.sessions ?? 0, vis.clicks ?? 0),
      rateLabel: "sessions per search click",
      sentence:
        "Website sessions occurred alongside search clicks in the same period. Search Console impressions and clicks carry no session identifier, so no click can be traced to a session.",
      note: "Both sides are property-wide unless a community scope narrows GA4 to mapped landing pages.",
    },
    {
      key: "traffic_conv",
      from: "Traffic",
      to: "Conversations",
      level: 3,
      rate: ratePct(f?.leads ?? 0, ga4Now.data?.sessions ?? 0),
      rateLabel: "Further leads per session",
      sentence:
        "Further conversations occurred alongside website traffic during the same period. There is no validated identifier bridging a GA4 session to a Further lead.",
      note: "The Further visitors endpoint is unavailable, so no session-level bridge exists today.",
    },
    {
      key: "conv_leads",
      from: "Conversations",
      to: "Leads",
      level: 1,
      rate: ratePct(f?.matched ?? 0, f?.leads ?? 0),
      rateLabel: "of Further leads matched to a CRM prospect",
      sentence: `${fmt(f?.matched)} Further leads ${EVIDENCE_VERBS[1]} an exact WelcomeHome prospect record.`,
      note: `Exact external-ID matching only. ${fmt(f?.with_external_id)} leads carry an external ID; ${fmt(
        f?.conflicts,
      )} are quarantined as duplicates or conflicts.`,
    },
    {
      key: "leads_tours",
      from: "Leads",
      to: "Tours",
      level: 2,
      rate: ratePct(wh.data?.tours ?? 0, wh.data?.inquiries ?? 0),
      rateLabel: "tours per inquiry in period",
      sentence:
        "Completed tours are linked with inquiries through CRM prospect records, but both are counted by event date in the period rather than as one cohort.",
      note: `Cohort view: ${fmt(wh.data?.cohort?.toured)} of ${fmt(
        wh.data?.cohort?.cohortSize,
      )} prospects who inquired in this period have since toured.`,
    },
    {
      key: "tours_deposits",
      from: "Tours",
      to: "Deposits",
      level: 2,
      rate: ratePct(wh.data?.deposits ?? 0, wh.data?.tours ?? 0),
      rateLabel: "depositors per completed tour",
      sentence:
        "Deposits are linked with tour activity through the same CRM prospect, counted by event date in the period.",
      note: `Cohort view: ${fmt(wh.data?.cohort?.deposited)} of this period's inquiries have deposited. Deposits remain a provisional metric.`,
    },
    {
      key: "deposits_movein",
      from: "Deposits",
      to: "Move-Ins",
      level: 2,
      rate: ratePct(wh.data?.moveIns ?? 0, wh.data?.deposits ?? 0),
      rateLabel: "move-ins per depositor",
      sentence:
        "Move-ins are linked with deposits through the CRM prospect and housing contract, counted by event date in the period.",
      note: `Cohort view: ${fmt(wh.data?.cohort?.movedIn)} of this period's inquiries have moved in.`,
    },
    {
      key: "movein_occ",
      from: "Move-Ins",
      to: "Occupancy",
      level: 2,
      rate:
        wh.data && occTotals?.censusCapacity
          ? ratePct(wh.data.moveIns - wh.data.moveOuts, occTotals.censusCapacity)
          : null,
      rateLabel: "net movement as a share of capacity",
      sentence:
        "Move-ins and move-outs are the operational drivers of occupancy, but occupancy also reflects transfers, notices and units taken off census.",
      note: "Occupancy uses each community's canonical capacity basis (rooms, occupancy points or configured capacity).",
    },
  ];

  const seriesDefs = [
    { key: "clicks", label: "Search clicks", color: CHART_TOKENS.primary },
    { key: "sessions", label: "Sessions", color: CHART_TOKENS.secondary },
    { key: "further_leads", label: "Further leads", color: CHART_TOKENS.tertiary },
    { key: "inquiries", label: "Inquiries", color: CHART_TOKENS.quaternary },
    { key: "tours", label: "Tours", color: CHART_TOKENS.muted },
    { key: "deposits", label: "Deposits", color: CHART_TOKENS.provisional },
    { key: "move_ins", label: "Move-ins", color: CHART_TOKENS.negative },
  ];
  const allKeys = seriesDefs.map((s) => s.key);
  const { visible, toggle } = useSeriesVisibility("mph-journey-series", allKeys, [
    "sessions",
    "further_leads",
    "inquiries",
    "tours",
    "move_ins",
  ]);

  const chartData = useMemo(
    () =>
      (series.data ?? []).map((p) => ({
        label:
          grain === "month"
            ? formatDateOnly(p.bucket, "MMM yyyy")
            : formatDateOnly(p.bucket, "MMM d"),
        clicks: p.clicks,
        sessions: p.sessions,
        further_leads: p.further_leads,
        inquiries: p.inquiries,
        tours: p.tours,
        deposits: p.deposits,
        move_ins: p.move_ins,
      })),
    [series.data, grain],
  );

  /* ------------------------------------------------- deterministic snapshot */

  // Every observation below restates a value already computed by a canonical
  // layer. Nothing is inferred, and no causal wording is used.
  const snapshot: string[] = [];
  {
    const dSessions = delta(ga4Now.data?.sessions ?? null, ga4Prior.data?.sessions ?? null);
    const dInq = delta(wh.data?.inquiries ?? null, whPrior.data?.inquiries ?? null);
    if (dSessions && dInq) {
      snapshot.push(
        `Website sessions ${dSessions.label === "No change" ? "were flat" : `moved ${dSessions.label}`} while new inquiries ${
          dInq.label === "No change" ? "were flat" : `moved ${dInq.label}`
        }.`,
      );
    }
    const matchRate = ratePct(f?.matched ?? 0, f?.leads ?? 0);
    if (f?.leads) {
      snapshot.push(
        `${fmtPct(matchRate)} of ${fmt(f.leads)} Further leads matched exactly to a WelcomeHome prospect.`,
      );
    }
    const tourRate = ratePct(wh.data?.tours ?? 0, wh.data?.inquiries ?? 0);
    if (wh.data?.inquiries) {
      snapshot.push(
        `Tours ran at ${fmtPct(tourRate)} of new inquiries in the selected period (${fmt(
          wh.data.tours,
        )} of ${fmt(wh.data.inquiries)}).`,
      );
    }
    if (wh.data) {
      const net = wh.data.moveIns - wh.data.moveOuts;
      snapshot.push(
        `${fmt(wh.data.moveIns)} move-ins and ${fmt(wh.data.moveOuts)} move-outs produced ${
          net > 0 ? "+" : ""
        }${fmt(net)} net movement.`,
      );
    }
    const dVis = delta(vis.clicks, visPrior.clicks);
    if (dVis && snapshot.length < 4) {
      snapshot.push(`Search clicks moved ${dVis.label} against the comparison period.`);
    }
  }
  const snapshotLoading = wh.isLoading || ga4Now.isLoading || furtherNow.isLoading;

  /* ----------------------------------------- matched digital conversations */

  const matchedCohort = f
    ? [
        { label: "Exact matched leads", value: f.matched, rate: null as number | null },
        { label: "Toured", value: f.matched_toured, rate: ratePct(f.matched_toured, f.matched) },
        {
          label: "Deposited",
          value: f.matched_deposited,
          rate: ratePct(f.matched_deposited, f.matched),
        },
        {
          label: "Moved in",
          value: f.matched_moved_in,
          rate: ratePct(f.matched_moved_in, f.matched),
        },
      ]
    : [];

  /* ------------------------------------------------------- by community */

  const matrixRows = matrix.data ?? [];
  const matrixLoading = matrix.isLoading || !(series.isFetched || series.isError);

  const sortValue = (r: JourneyCommunityRow, key: string): number | string => {
    switch (key) {
      case "name":
        return r.community_name;
      case "matched":
        return r.further_leads ? r.further_matched / r.further_leads : -1;
      case "net":
        return Number(r.move_ins) - Number(r.move_outs);
      default:
        return Number((r as unknown as Record<string, number>)[key] ?? 0);
    }
  };
  const sortedRows = useMemo(() => {
    const rows = [...matrixRows];
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [matrixRows, sortKey, sortDir]);

  const matrixColumns: { key: string; header: string; numeric?: boolean }[] = [
    { key: "name", header: "Community" },
    { key: "sessions", header: "Sessions", numeric: true },
    { key: "further_leads", header: "Further leads", numeric: true },
    { key: "matched", header: "Exact match %", numeric: true },
    { key: "inquiries", header: "Inquiries", numeric: true },
    { key: "tours", header: "Tours", numeric: true },
    { key: "deposits", header: "Deposits", numeric: true },
    { key: "move_ins", header: "Move-ins", numeric: true },
    { key: "move_outs", header: "Move-outs", numeric: true },
    { key: "net", header: "Net", numeric: true },
  ];

  const totals = matrixRows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + Number(r.sessions),
      further_leads: acc.further_leads + Number(r.further_leads),
      inquiries: acc.inquiries + Number(r.inquiries),
      tours: acc.tours + Number(r.tours),
      deposits: acc.deposits + Number(r.deposits),
      move_ins: acc.move_ins + Number(r.move_ins),
      move_outs: acc.move_outs + Number(r.move_outs),
    }),
    {
      sessions: 0,
      further_leads: 0,
      inquiries: 0,
      tours: 0,
      deposits: 0,
      move_ins: 0,
      move_outs: 0,
    },
  );

  const txLoading: Record<string, boolean> = {
    vis_traffic: visLoading || ga4Now.isLoading,
    traffic_conv: ga4Now.isLoading || furtherNow.isLoading,
    conv_leads: furtherNow.isLoading,
    leads_tours: wh.isLoading,
    tours_deposits: wh.isLoading,
    deposits_movein: wh.isLoading,
    movein_occ: wh.isLoading || occupancy.isLoading || !occDone,
  };


  if (!ctx.organizationId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Performance Journey" title="From visibility to occupancy" />
        <EmptyState title="Select an organization" description="Choose an organization to load the journey." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Performance Journey"
        title="From visibility to occupancy"
        description="See how marketing activity, website traffic, conversations, sales activity and occupancy move together across the resident journey."
      />

      <p className="text-xs text-muted-foreground">
        {formatPeriodLabel(period)} · {scopeLabel} · {priorLabel} ({formatPeriodLabel(prior)})
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Journey stages</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stages.map((s, i) => (
            <StageCard key={s.key} stage={s} index={i} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Stage to stage</h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Each transition states the evidence behind it. Only Level 1 links are record-level
            proven; Level 3 links describe two measured things moving together in the same period
            and never imply that one caused the other.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {transitions.map((t) => (
            <TransitionCard key={t.key} t={t} />
          ))}
        </div>
      </section>

      <ChartCard
        title="The journey over time"
        description={`One point per ${grain}. Every series is read from its own canonical source; nothing is prorated across buckets.`}
        loading={series.isLoading}
        empty={chartData.length ? undefined : "No data in this range."}
        height={340}
        actions={
          <SeriesToggleChips
            series={seriesDefs}
            visible={visible}
            onToggle={toggle}
          />
        }
      >
        <MetricTrendChart
          data={chartData}
          series={seriesDefs.filter((s) => visible.includes(s.key))}
        />
      </ChartCard>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">By community</h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Sessions come from deterministically mapped landing pages only, so they do not add up to
            property-wide traffic. Search visibility is not split by community here because Search
            Console reports at property level.
          </p>
        </div>
        <DataTable
          columns={columns}
          rows={matrixRows}
          loading={matrix.isLoading}
          empty={<EmptyState title="No communities in scope" />}
        />
        {matrixRows.length ? (
          <p className="text-xs text-muted-foreground">
            Totals — mapped sessions {fmt(totals.sessions)} · Further leads {fmt(totals.further_leads)} ·
            inquiries {fmt(totals.inquiries)} · tours {fmt(totals.tours)} · deposits{" "}
            {fmt(totals.deposits)} · move-ins {fmt(totals.move_ins)}
          </p>
        ) : null}
      </section>

      <section className="panel space-y-2 p-5">
        <h2 className="text-sm font-semibold text-foreground">What this page can and cannot prove</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Search Console reports at property level, so visibility for a single community relies on
            the deterministic URL mapping rules and covers mapped pages only.
          </li>
          <li>
            GA4 community scope uses mapped landing pages; property-wide totals are never split
            across communities. Partial current days are excluded from every comparison.
          </li>
          <li>
            Further conversations link to WelcomeHome by exact external ID only. Leads without an
            external ID, and duplicates or community conflicts, are never counted as matched.
          </li>
          <li>
            Deposits remain a provisional metric and keep that status here.
          </li>
          <li>
            Occupancy is current state on each community's canonical capacity basis; the comparison
            point comes from stored history and is blank when no history exists for that period.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Source coverage and freshness in detail:{" "}
          <Link to="/data-health" className="underline">
            Data Health
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
