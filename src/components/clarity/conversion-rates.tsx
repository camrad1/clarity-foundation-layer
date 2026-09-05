import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CHART_TOKENS, ChartCard, MetricTrendChart } from "@/components/clarity/charts";
import { EmptyState } from "@/components/clarity/empty-state";
import {
  MIN_COHORT_SAMPLE,
  rate,
  useWhConversion,
  useWhConversionSeries,
  type ConversionBreakdownRow,
  type ConversionCommunityRow,
  type WhConversion,
} from "@/lib/wh/conversion";
import { cn } from "@/lib/utils";

/**
 * Conversion Rates.
 *
 * Answers "how effectively are leads progressing through the funnel?" using
 * only the existing, validated WelcomeHome definitions (new inquiries,
 * completed tours, re-tours, standard deposits, counted move-ins). Nothing is
 * redefined here and no numerator or denominator is computed in the browser:
 * every count comes from public.wh_conversion_rates / wh_conversion_series.
 *
 * True cohort conversion (inquiry cohort followed forward in time) and
 * descriptive period activity ratios are presented in separate, clearly
 * labelled places and are never blended.
 */

const pct1 = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const pts = (d: number) => `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)} pts`;

type GrainOption = "day" | "week" | "month";

export function ConversionRatesTab({
  organizationId,
  communityIds,
  range,
  prior,
  comparisonLabel,
  priorLabel,
  communityNames,
  counselorLabel,
  leadSourceLabel,
  onDrill,
}: {
  organizationId: string | null;
  communityIds: string[];
  range: { start: string; end: string };
  prior: { start: string; end: string };
  comparisonLabel: string;
  priorLabel: string;
  communityNames: Record<string, string>;
  counselorLabel: (id: string) => string;
  leadSourceLabel: (id: string) => string;
  /** Jump to the tab that already lists the underlying records. */
  onDrill: (tab: string) => void;
}) {
  const current = useWhConversion(organizationId, communityIds, range.start, range.end);
  const previous = useWhConversion(organizationId, communityIds, prior.start, prior.end);

  const days = useMemo(() => {
    const a = new Date(`${range.start}T00:00:00Z`).getTime();
    const b = new Date(`${range.end}T00:00:00Z`).getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [range.start, range.end]);

  // Long ranges default to monthly cohorts; short ones to weekly/daily.
  const defaultGrain: GrainOption = days > 92 ? "month" : days > 21 ? "week" : "day";
  const [grain, setGrain] = useState<GrainOption | null>(null);
  const activeGrain = grain ?? defaultGrain;
  const series = useWhConversionSeries(organizationId, communityIds, range.start, range.end, activeGrain);

  if (current.isLoading) {
    return <div className="panel px-6 py-16 text-center text-sm text-muted-foreground">Calculating conversion…</div>;
  }
  if (current.error) {
    return (
      <EmptyState
        title="Conversion rates could not be calculated"
        description={(current.error as Error).message}
      />
    );
  }
  const c = current.data;
  if (!c) return <EmptyState title="No conversion data for this selection" />;
  const prev = previous.data ?? null;

  const single = communityIds.length === 1;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-8">
      <CohortKpis c={c} prev={prev} priorLabel={priorLabel} comparisonLabel={comparisonLabel} onDrill={onDrill} />

      <CohortFunnel c={c} onDrill={onDrill} />

      <PeriodRatios c={c} />

      <ChartCard
        title="Conversion over time"
        description={`Each point is the inquiry cohort for that ${activeGrain}, followed forward to a tour, deposit and move-in. Recent cohorts are still maturing, so the right-hand edge of every line normally sits low.`}
        height={300}
        actions={
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["day", "week", "month"] as GrainOption[]).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={activeGrain === g ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs capitalize"
                onClick={() => setGrain(g)}
              >
                {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
              </Button>
            ))}
          </div>
        }
        empty={(series.data?.points.length ?? 0) === 0 ? "No inquiry cohorts in this range." : undefined}
      >
        <MetricTrendChart
          data={(series.data?.points ?? []).map((p) => ({
            label: p.bucket,
            inquiries: p.inquiries,
            inq_tour: p.inquiries ? Number(((p.toured / p.inquiries) * 100).toFixed(1)) : 0,
            tour_dep: p.toured ? Number(((p.deposited / p.toured) * 100).toFixed(1)) : 0,
            dep_mi: p.deposited ? Number(((p.movedIn / p.deposited) * 100).toFixed(1)) : 0,
            tour_mi: p.toured ? Number(((p.touredThenMovedIn / p.toured) * 100).toFixed(1)) : 0,
            inq_mi: p.inquiries ? Number(((p.movedIn / p.inquiries) * 100).toFixed(1)) : 0,
          }))}
          series={[
            { key: "inq_tour", label: "Inquiry → Tour %", color: CHART_TOKENS.primary },
            { key: "tour_dep", label: "Tour → Deposit %", color: CHART_TOKENS.secondary },
            { key: "dep_mi", label: "Deposit → Move-in %", color: CHART_TOKENS.tertiary },
            { key: "tour_mi", label: "Tour → Move-in %", color: CHART_TOKENS.negative },
            { key: "inq_mi", label: "Inquiry → Move-in %", color: CHART_TOKENS.quaternary },
          ]}
          valueFormatter={(v) => `${v.toFixed(1)}%`}
        />
      </ChartCard>

      <Maturity c={c} />

      <BreakdownTable
        title="Conversion by lead source"
        description="Cohort conversion for the inquiries recorded against each WelcomeHome lead source. Source attribution is taken exactly as recorded; nothing is merged or inferred. A source mix difference is not evidence that a channel caused a conversion."
        rows={c.byLeadSource}
        label={leadSourceLabel}
        firstHeader="Lead source"
      />

      {single ? (
        <SingleCommunityView c={c} communityNames={communityNames} />
      ) : (
        <CommunityTable rows={c.byCommunity} communityNames={communityNames} />
      )}

      <BreakdownTable
        title="Conversion by counselor"
        description="Inquiries are grouped by the sales counselor currently recorded on the prospect, using the existing WelcomeHome assignment. Counts are descriptive: caseload, community mix and lead quality all differ, so this is not a performance ranking."
        rows={c.byCounselor}
        label={counselorLabel}
        firstHeader="Counselor"
      />

      <Methodology c={c} />
    </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ KPI row */

function CohortKpis({
  c,
  prev,
  priorLabel,
  comparisonLabel,
  onDrill,
}: {
  c: WhConversion;
  prev: WhConversion | null;
  priorLabel: string;
  comparisonLabel: string;
  onDrill: (tab: string) => void;
}) {
  const cmpNote = `${priorLabel} · ${comparisonLabel}`;
  // Deposits exist in the period but none of them tie back to a cohort
  // prospect: the cohort deposit chain cannot be evaluated for this scope, so
  // the two deposit-dependent rates are withheld rather than shown as 0%.
  const depositLinkage = !(c.cohort.deposited === 0 && c.period.deposits > 0);
  const cards = [
    {
      label: "Inquiry → Tour",
      current: rate(c.cohort.toured, c.cohort.size),
      previous: prev ? rate(prev.cohort.toured, prev.cohort.size) : null,
      num: c.cohort.toured,
      den: c.cohort.size,
      numLabel: "cohort prospects with a completed tour",
      denLabel: "inquiries in the cohort",
      provisional: false,
      drill: "inquiries",
      tip: "Of the countable prospects whose inquiry date falls in the selected period, the share with at least one completed tour activity carrying a successful WelcomeHome result — at any later date, inside or outside the period.",
    },
    {
      label: "Tour → Deposit",
      current: rate(c.cohort.touredThenDeposited, c.cohort.toured),
      previous: prev ? rate(prev.cohort.touredThenDeposited, prev.cohort.toured) : null,
      num: c.cohort.touredThenDeposited,
      den: c.cohort.toured ?? 0,
      numLabel: "of those who toured also deposited",
      denLabel: "cohort prospects who toured",
      provisional: true,
      drill: "funnel",
      unavailable: !depositLinkage,
      tip: "Within the same inquiry cohort: of the prospects who completed a tour, the share who later placed a standard deposit (transaction type Deposit, amount above zero). The deposit stage is provisional.",
    },
    {
      label: "Deposit → Move-in",
      current: rate(c.cohort.depositedThenMovedIn, c.cohort.deposited),
      previous: prev ? rate(prev.cohort.depositedThenMovedIn, prev.cohort.deposited) : null,
      num: c.cohort.depositedThenMovedIn,
      den: c.cohort.deposited,
      numLabel: "of those who deposited also moved in",
      denLabel: "cohort prospects who deposited",
      provisional: true,
      drill: "funnel",
      unavailable: !depositLinkage,
      tip: "Within the same inquiry cohort: of the prospects who placed a standard deposit, the share with a counted move-in on a non-canceled contract. The deposit stage is provisional.",
    },
    {
      label: "Tour → Move-in",
      current: rate(c.cohort.touredThenMovedIn, c.cohort.toured),
      previous: prev ? rate(prev.cohort.touredThenMovedIn, prev.cohort.toured) : null,
      num: c.cohort.touredThenMovedIn,
      den: c.cohort.toured ?? 0,
      numLabel: "of those who toured also moved in",
      denLabel: "cohort prospects who toured",
      provisional: false,
      drill: "funnel",
      tip: "Within the same inquiry cohort: of the prospects who completed a successful tour, the share with a counted move-in on a non-canceled contract at any later date. A deposit is not required, so this rate is unaffected by the provisional deposit stage. It is not move-ins recorded in the period divided by tours recorded in the period.",
    },
    {
      label: "Inquiry → Move-in",
      current: rate(c.cohort.movedIn, c.cohort.size),
      previous: prev ? rate(prev.cohort.movedIn, prev.cohort.size) : null,
      num: c.cohort.movedIn,
      den: c.cohort.size,
      numLabel: "cohort prospects who moved in",
      denLabel: "inquiries in the cohort",
      provisional: false,
      drill: "inquiries",
      tip: "End-to-end cohort conversion: of the prospects who inquired in the selected period, the share with a counted move-in on a non-canceled contract at any later date. Transfers and canceled leases are excluded.",
    },
    {
      label: "Re-tour rate",
      current: rate(c.period.reTours, c.period.tours),
      previous: prev ? rate(prev.period.reTours, prev.period.tours) : null,
      num: c.period.reTours,
      den: c.period.tours,
      numLabel: "repeat tours completed in the period",
      denLabel: "completed tours in the period",
      provisional: false,
      drill: "funnel",
      tip: "Period activity ratio, not cohort conversion: of all successful tours completed in the selected period, the share that were not the prospect's first completed tour.",
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Cohort conversion</h2>
        <p className="text-xs text-muted-foreground">
          Inquiry cohort of {c.cohort.size.toLocaleString()} prospects, followed forward as of {c.asOf}.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <RateCard key={card.label} {...card} comparisonNote={cmpNote} onDrill={onDrill} />
        ))}
      </div>
    </section>
  );
}

function RateCard({
  label,
  current,
  previous,
  num,
  den,
  numLabel,
  denLabel,
  provisional,
  tip,
  comparisonNote,
  drill,
  unavailable,
  onDrill,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  num: number | null;
  den: number;
  numLabel: string;
  denLabel: string;
  provisional: boolean;
  tip: string;
  comparisonNote: string;
  drill: string;
  /** Stage cannot be evaluated on the cohort chain — withhold, never show 0%. */
  unavailable?: boolean;
  onDrill: (tab: string) => void;
}) {
  const delta = current != null && previous != null ? current - previous : null;
  return (
    <div className="kpi-card space-y-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`How ${label} is calculated`} className="text-muted-foreground">
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">{tip}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-display text-2xl font-semibold tracking-tight text-brand">
          {unavailable ? <span className="text-lg text-muted-foreground">Not yet linkable</span> : pct1(current)}
        </p>
        {!unavailable && delta != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              Math.abs(delta) < 0.0005
                ? "text-muted-foreground"
                : delta > 0
                  ? "text-success"
                  : "text-destructive",
            )}
            title={`${comparisonNote}: ${pct1(previous)}`}
          >
            {Math.abs(delta) < 0.0005 ? (
              <ArrowRight className="size-3" />
            ) : delta > 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {pts(delta)}
          </span>
        ) : null}
        {provisional ? (
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            Provisional
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {unavailable
          ? "Deposits are recorded in this period but none can be tied back to a prospect in this inquiry cohort, so the rate is withheld rather than reported as zero. Period deposit counts are in the activity ratios below."
          : `${(num ?? 0).toLocaleString()} ${numLabel} ÷ ${den.toLocaleString()} ${denLabel}`}
      </p>
      <button
        type="button"
        onClick={() => onDrill(drill)}
        className="text-xs font-medium text-brand underline-offset-2 hover:underline"
      >
        View the records
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- the funnel */

function CohortFunnel({ c, onDrill }: { c: WhConversion; onDrill: (tab: string) => void }) {
  const depositLinkage = !(c.cohort.deposited === 0 && c.period.deposits > 0);
  const stages = [
    { label: "Inquiries", value: c.cohort.size, provisional: false },
    { label: "Toured", value: c.cohort.toured ?? 0, provisional: false },
    { label: "Deposited", value: c.cohort.deposited, provisional: true },
    { label: "Moved in", value: c.cohort.movedIn, provisional: false },
  ];
  const base = stages[0]!.value || 1;
  return (
    <section className="panel space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Cohort progression</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          One cohort — the prospects who inquired in the selected period — followed through each stage. Every
          prospect is counted once per stage, so the steps always reconcile down the chain.
        </p>
      </div>
      {!depositLinkage ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground">
          The deposit step is blank because no deposit in this period can be matched back to a prospect in this
          inquiry cohort. Deposits themselves are counted — {c.period.deposits.toLocaleString()} in the period — but
          the link from deposit to originating inquiry is not yet reliable, which is part of the known provisional
          status of the deposit metric.
        </p>
      ) : null}
      {c.period.tours === 0 && c.period.inquiries > 0 ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground">
          No completed tours are recorded for this selection, so every tour-based rate reads zero. That normally means
          tour activity types are not yet mapped for this community rather than that no tours happened.
        </p>
      ) : null}
      <div className="space-y-3">
        {stages.map((stage, i) => {
          const prevStage = i > 0 ? stages[i - 1]!.value : null;
          const step = prevStage && prevStage > 0 ? stage.value / prevStage : null;
          return (
            <div key={stage.label} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {stage.label}
                  {stage.provisional ? (
                    <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Provisional
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-display text-sm font-semibold tabular-nums text-foreground">
                    {stage.label === "Deposited" && !depositLinkage ? "—" : stage.value.toLocaleString()}
                  </span>
                  {step != null && depositLinkage ? (
                    <span className="ml-2">{pct1(step)} of previous stage</span>
                  ) : null}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-brand-soft">
                <div
                  className="h-2 rounded-full bg-brand"
                  style={{ width: `${Math.max(2, (stage.value / base) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onDrill("funnel")}
        className="text-xs font-medium text-brand underline-offset-2 hover:underline"
      >
        Open the funnel tab for record-level tours, deposits and move-ins
      </button>
    </section>
  );
}

/* ---------------------------------------------- descriptive period activity */

function PeriodRatios({ c }: { c: WhConversion }) {
  const rows = [
    { label: "Completed tours ÷ new inquiries", value: rate(c.period.tours, c.period.inquiries), n: `${c.period.tours} ÷ ${c.period.inquiries}` },
    { label: "Deposits ÷ completed tours", value: rate(c.period.deposits, c.period.tours), n: `${c.period.deposits} ÷ ${c.period.tours}` },
    { label: "Move-ins ÷ deposits", value: rate(c.period.moveIns, c.period.deposits), n: `${c.period.moveIns} ÷ ${c.period.deposits}` },
    { label: "Move-ins ÷ new inquiries", value: rate(c.period.moveIns, c.period.inquiries), n: `${c.period.moveIns} ÷ ${c.period.inquiries}` },
  ];
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="period" className="panel px-5">
        <AccordionTrigger className="text-sm font-semibold">
          Period activity ratios (not conversion)
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pb-4">
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            These divide events recorded in the same period. The move-ins counted here mostly belong to inquiries
            from earlier months, so they describe throughput, not the conversion of this period's leads. They are
            kept separate on purpose and never mixed with the cohort rates above.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ratio</TableHead>
                <TableHead className="text-right">Counts</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct1(r.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/* ------------------------------------------------------------ cohort ageing */

function Maturity({ c }: { c: WhConversion }) {
  if (!c.maturity.length) return null;
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Cohort maturity</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          The same cohort split by how long each inquiry has had to convert, measured to {c.asOf}. Senior living
          decisions routinely take months, so a young slice with a low rate is not underperformance — it has simply
          not had time yet. Compare like-aged slices across periods rather than the headline rate alone.
        </p>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Inquiry age</TableHead>
              <TableHead className="text-right">Inquiries</TableHead>
              <TableHead className="text-right">Toured</TableHead>
              <TableHead className="text-right">Inquiry → Tour</TableHead>
              <TableHead className="text-right">Moved in</TableHead>
              <TableHead className="text-right">Tour → Move-in</TableHead>
              <TableHead className="text-right">Inquiry → Move-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.maturity.map((m) => (
              <TableRow key={m.bucket} className="odd:bg-brand-soft/60">
                <TableCell className="font-medium">{m.bucket}</TableCell>
                <TableCell className="text-right tabular-nums">{m.size.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{m.toured.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.size >= MIN_COHORT_SAMPLE ? pct1(rate(m.toured, m.size)) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.movedIn.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.size >= MIN_COHORT_SAMPLE ? pct1(rate(m.touredThenMovedIn, m.toured)) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.size >= MIN_COHORT_SAMPLE ? pct1(rate(m.movedIn, m.size)) : <SmallSample />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SmallSample() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Small sample
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        Fewer than {MIN_COHORT_SAMPLE} inquiries in this cohort. The counts are shown, the rate is withheld so a
        handful of records is not read as a trend.
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------- generic breakdowns */

type SortKey =
  | "label"
  | "inquiries"
  | "toured"
  | "inqTour"
  | "deposited"
  | "tourMoveIn"
  | "movedIn"
  | "inqMoveIn";

function BreakdownTable({
  title,
  description,
  rows,
  label,
  firstHeader,
}: {
  title: string;
  description: string;
  rows: ConversionBreakdownRow[];
  label: (id: string) => string;
  firstHeader: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "inquiries", dir: "desc" });
  const [showAll, setShowAll] = useState(false);

  const decorated = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        name: label(r.id),
        big: r.inquiries >= MIN_COHORT_SAMPLE,
        inqTour: rate(r.toured, r.inquiries),
        inqDep: rate(r.deposited, r.inquiries),
        tourMoveIn: rate(r.touredThenMovedIn, r.toured),
        inqMoveIn: rate(r.movedIn, r.inquiries),
      })),
    [rows, label],
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...decorated].sort((a, b) => {
      if (sort.key === "label") return a.name.localeCompare(b.name) * dir;
      const av = (a as any)[sort.key] ?? -1;
      const bv = (b as any)[sort.key] ?? -1;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [decorated, sort]);

  const visible = showAll ? sorted : sorted.slice(0, 10);
  const suppressed = decorated.filter((r) => !r.big).length;

  const th = (key: SortKey, text: string, align: "left" | "right" = "right") => (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() =>
          setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))
        }
      >
        {text}
        <span className="text-[10px]">{sort.key === key ? (sort.dir === "desc" ? "▼" : "▲") : "▼"}</span>
      </button>
    </TableHead>
  );

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {th("label", firstHeader, "left")}
              {th("inquiries", "Inquiries")}
              {th("inqTour", "Inquiry → Tour")}
              <TableHead className="text-right">Inquiry → Deposit</TableHead>
              {th("tourMoveIn", "Tour → Move-in")}
              {th("inqMoveIn", "Inquiry → Move-in")}
              {th("movedIn", "Move-ins")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} className="odd:bg-brand-soft/60">
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.inquiries.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.big ? pct1(r.inqTour) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.big ? pct1(r.inqDep) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.big ? pct1(r.tourMoveIn) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.big ? pct1(r.inqMoveIn) : <SmallSample />}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.movedIn.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length} rows · rates shown only at {MIN_COHORT_SAMPLE}+ inquiries ({suppressed} below the threshold,
        counts still shown) · deposit-based columns are provisional.
        {sorted.length > 10 ? (
          <button
            type="button"
            className="ml-2 font-medium text-brand underline-offset-2 hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show top 10" : `Show all ${sorted.length}`}
          </button>
        ) : null}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- communities */

type CommunitySortKey =
  | "label"
  | "inquiries"
  | "inqTour"
  | "tourDep"
  | "depMi"
  | "tourMi"
  | "inqMi";

function CommunityTable({
  rows,
  communityNames,
}: {
  rows: ConversionCommunityRow[];
  communityNames: Record<string, string>;
}) {
  const [sort, setSort] = useState<{ key: CommunitySortKey; dir: "asc" | "desc" }>({
    key: "inquiries",
    dir: "desc",
  });

  const decorated = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        name: communityNames[r.id] ?? "Unknown community",
        big: r.inquiries >= MIN_COHORT_SAMPLE,
        inqTour: rate(r.toured, r.inquiries),
        tourDep: rate(r.deposited, r.toured),
        depMi: rate(r.movedIn, r.deposited),
        tourMi: rate(r.touredThenMovedIn, r.toured),
        inqMi: rate(r.movedIn, r.inquiries),
      })),
    [rows, communityNames],
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...decorated].sort((a, b) => {
      if (sort.key === "label") return a.name.localeCompare(b.name) * dir;
      return ((Number((a as any)[sort.key] ?? -1)) - Number((b as any)[sort.key] ?? -1)) * dir;
    });
  }, [decorated, sort]);

  const th = (key: CommunitySortKey, text: string, align: "left" | "right" = "right") => (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
      >
        {text}
        <span className="text-[10px]">{sort.key === key ? (sort.dir === "desc" ? "▼" : "▲") : "▼"}</span>
      </button>
    </TableHead>
  );

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Conversion by community</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Cohort conversion per community. Stage counts are the same cohort followed forward, so tours, deposits
          and move-ins here can fall outside the selected period.
        </p>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {th("label", "Community", "left")}
              {th("inquiries", "Inquiries")}
              <TableHead className="text-right">Toured</TableHead>
              <TableHead className="text-right">Deposited</TableHead>
              <TableHead className="text-right">Moved in</TableHead>
              {th("inqTour", "Inq → Tour")}
              {th("tourDep", "Tour → Dep")}
              {th("depMi", "Dep → MI")}
              {th("tourMi", "Tour → MI")}
              {th("inqMi", "Inq → MI")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id} className="odd:bg-brand-soft/60">
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.inquiries.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.toured.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.deposited.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.movedIn.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.big ? pct1(r.inqTour) : <SmallSample />}</TableCell>
                <TableCell className="text-right tabular-nums">{r.big ? pct1(r.tourDep) : <SmallSample />}</TableCell>
                <TableCell className="text-right tabular-nums">{r.big ? pct1(r.depMi) : <SmallSample />}</TableCell>
                <TableCell className="text-right tabular-nums">{r.big ? pct1(r.tourMi) : <SmallSample />}</TableCell>
                <TableCell className="text-right tabular-nums">{r.big ? pct1(r.inqMi) : <SmallSample />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Rates shown only where the community cohort reaches {MIN_COHORT_SAMPLE} inquiries · deposit columns are
        provisional.
      </p>
    </section>
  );
}

function SingleCommunityView({
  c,
  communityNames,
}: {
  c: WhConversion;
  communityNames: Record<string, string>;
}) {
  const row = c.byCommunity[0];
  if (!row) return null;
  const name = communityNames[row.id] ?? "Selected community";
  const items = [
    { label: "Inquiries (cohort)", value: row.inquiries.toLocaleString(), note: "Prospects who inquired in the period" },
    { label: "Toured", value: row.toured.toLocaleString(), note: pct1(rate(row.toured, row.inquiries)) + " of the cohort" },
    { label: "Deposited", value: row.deposited.toLocaleString(), note: pct1(rate(row.deposited, row.inquiries)) + " of the cohort · provisional" },
    { label: "Moved in", value: row.movedIn.toLocaleString(), note: pct1(rate(row.movedIn, row.inquiries)) + " of the cohort" },
    {
      label: "Tour → Move-in",
      value: pct1(rate(row.touredThenMovedIn, row.toured)),
      note: `${row.touredThenMovedIn.toLocaleString()} of ${row.toured.toLocaleString()} toured prospects moved in`,
    },
    { label: "Tours recorded in period", value: row.periodTours.toLocaleString(), note: "Activity in the period, any cohort" },
    { label: "Move-ins recorded in period", value: row.periodMoveIns.toLocaleString(), note: "Activity in the period, any cohort" },
  ];
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{name} — conversion detail</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          One community is selected, so the cross-community comparison is replaced by its own cohort detail. Cohort
          stages and period activity are listed separately.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="panel space-y-1 p-4">
            <p className="eyebrow">{i.label}</p>
            <p className="font-display text-xl font-semibold text-brand">{i.value}</p>
            <p className="text-xs text-muted-foreground">{i.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- methodology */

function Methodology({ c }: { c: WhConversion }) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="how" className="panel px-5">
        <AccordionTrigger className="text-sm font-semibold">How conversions are calculated</AccordionTrigger>
        <AccordionContent className="space-y-3 pb-4 text-xs leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">Cohort.</strong> Countable prospects whose WelcomeHome inquiry date
            (converted to community-local dates) falls inside the selected range. Merged and discarded prospects are
            excluded, exactly as everywhere else in Sales Intelligence.
          </p>
          <p>
            <strong className="text-foreground">Stages.</strong> Tour = a completed tour activity with a successful
            WelcomeHome result. Deposit = a standard deposit transaction (type Deposit, amount above zero); refunds,
            waitlist and zero-amount rows are excluded. Move-in = a counted move-in on a non-canceled contract;
            transfers are excluded. No definition is changed on this tab.
          </p>
          <p>
            <strong className="text-foreground">Direction of time.</strong> Cohort stages look forward without a cut-off,
            so a prospect who inquired in the period and moves in three months later still counts. That is why cohort
            rates for recent periods keep rising as time passes.
          </p>
          <p>
            <strong className="text-foreground">Tour → Move-in.</strong> A cross-stage cohort rate: of the cohort
            prospects who completed a successful tour, the share who later moved in. It does not require a deposit,
            so it stays usable while the deposit stage is provisional, and it is never calculated as move-ins
            recorded in the period divided by tours recorded in the period. The sequential funnel below is
            unchanged: Inquiry → Tour → Deposit → Move-in.
          </p>
          <p>
            <strong className="text-foreground">Comparison.</strong> Rate changes are reported in percentage points
            against the selected comparison period, not as a percent of a percent.
          </p>
          <p>
            <strong className="text-foreground">Small samples.</strong> Any breakdown row with fewer than{" "}
            {MIN_COHORT_SAMPLE} inquiries shows its raw counts but withholds the rate.
          </p>
          <p>
            <strong className="text-foreground">Deposits are provisional.</strong> A known WelcomeHome reporting
            limitation prevents full reconciliation of the depositor list, so every deposit-based rate carries the
            provisional flag.
          </p>
          <p>
            Calculated in the database as of {new Date(c.generatedAt).toLocaleString()} · cohort aged to {c.asOf}.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
