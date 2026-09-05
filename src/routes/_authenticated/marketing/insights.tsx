import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Lightbulb, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { GscExportNotice } from "@/components/clarity/gsc-export-notice";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommunities } from "@/lib/clarity-queries";
import { formatPeriodLabel } from "@/lib/date-ranges";
import { fmtInt, fmtPercent, fmtPosition } from "@/lib/gsc/format";
import { explainInsight } from "@/lib/gsc/explain.functions";
import {
  COMPARISON_RULE,
  PRIORITY_LABELS,
  communityMovers,
  ctrOpportunities,
  intentMix,
  isComparablePeriod,
  nearPageOne,
  pageDeclines,
  pageGains,
  pageOpportunities,
  priorTotalsOf,
  queryDeclines,
  queryGains,
  sortByPriority,
  totalsOf,
  type Insight,
  type PageRow,
  type Priority,
  type QueryRow,
} from "@/lib/gsc/insights";
import { useSearchPageReport, useSearchQueryReport } from "@/lib/gsc/api-queries";
import { GscManualSourceNote, GscSourceNote } from "@/components/clarity/gsc-source-note";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing/insights")({
  head: () => ({
    meta: [
      { title: "Search Insights — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Rule-based Search Console insights: biggest gains and declines, click-through and near-page-one opportunities, community movers and intent mix.",
      },
      { property: "og:title", content: "Search Insights — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content:
          "What changed, what matters and what to work on next — every insight traceable to imported Search Console rows.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchInsights,
});

const PRIORITY_TONE: Record<Priority, string> = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-primary/40 bg-primary/10 text-primary",
  low: "border-border bg-muted text-muted-foreground",
};

function InsightCard({ insight }: { insight: Insight }) {
  const explain = useServerFn(explainInsight);
  const mutation = useMutation({
    mutationFn: () =>
      explain({
        data: {
          subject: insight.subject,
          kind: insight.kind,
          signal: insight.signal,
          rule: insight.rule,
          evidence: insight.evidence,
        },
      }),
  });

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground break-all">{insight.subject}</p>
        <Badge
          variant="outline"
          className={cn("shrink-0 text-[11px]", PRIORITY_TONE[insight.priority])}
        >
          {PRIORITY_LABELS[insight.priority]}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{insight.signal}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {insight.evidence.map((e) => (
          <div key={e.label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{e.label}</dt>
            <dd className="font-medium text-foreground">{e.value}</dd>
          </div>
        ))}
      </dl>

      {mutation.data?.text ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {mutation.data.text}
          <span className="mt-1 block text-[11px] opacity-70">
            Wording only. All figures above are calculated from the imported export.
          </span>
        </p>
      ) : null}
      {mutation.data?.error ? (
        <p className="text-xs text-destructive">{mutation.data.error}</p>
      ) : null}
      {mutation.isError ? (
        <p className="text-xs text-destructive">The explanation could not be generated.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {insight.link ? (
          <Button asChild variant="outline" size="sm">
            <Link to={insight.link.to} search={insight.link.search ?? {}}>
              {insight.link.label} <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending || !!mutation.data?.text}
          onClick={() => mutation.mutate()}
        >
          <Sparkles className="size-3.5" />
          {mutation.isPending ? "Explaining…" : "Explain in plain English"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground/80">{insight.rule}</p>
    </div>
  );
}

function Section({
  title,
  description,
  insights,
  empty,
}: {
  title: string;
  description: string;
  insights: Insight[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {insights.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      ) : (
        <p className="panel px-4 py-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function SearchInsights() {
  const { organizationId, dateRange, comparisonRange, communityScope } = useAppState();
  const communities = useCommunities(organizationId);
  const period = { start: dateRange.start, end: dateRange.end };

  const [queryImportId, setQueryImportId] = useState<string | null>(null);
  const [pageImportId, setPageImportId] = useState<string | null>(null);

  const queryReport = useSearchQueryReport(organizationId, period, comparisonRange, queryImportId);
  const pageReport = useSearchPageReport(organizationId, period, comparisonRange, pageImportId);
  const querySelection = queryReport.selection;
  const pageSelection = pageReport.selection;

  // API rows carry real dates, so the globally selected comparison period is
  // used directly. Manual exports are only compared with a prior export of a
  // genuinely similar span.
  const periodOf = (g: { period_start: string | null; period_end: string | null } | null) =>
    g?.period_start && g.period_end ? { start: g.period_start, end: g.period_end } : null;

  const queryComparable =
    queryReport.source === "api"
      ? !!comparisonRange
      : isComparablePeriod(periodOf(querySelection.current), periodOf(querySelection.comparison));
  const pageComparable =
    pageReport.source === "api"
      ? !!comparisonRange
      : isComparablePeriod(periodOf(pageSelection.current), periodOf(pageSelection.comparison));

  const scopedIds = useMemo(
    () =>
      new Set(
        resolveSelectedCommunityIds(
          communityScope,
          (communities.data ?? []).map((c) => ({ id: c.id, region_id: c.region_id ?? null })),
        ),
      ),
    [communityScope, communities.data],
  );

  const allQueries = (queryReport.data ?? []) as QueryRow[];
  const allPages = (pageReport.data ?? []) as PageRow[];

  // Query rows carry no URL, so a community filter can only scope page-level
  // insights. Query insights are suppressed rather than shown property-wide.
  const scopedPages = useMemo(
    () =>
      communityScope.mode === "all"
        ? allPages
        : allPages.filter((r) => r.mapped_community_id && scopedIds.has(r.mapped_community_id)),
    [allPages, communityScope.mode, scopedIds],
  );

  const communityFiltered = communityScope.mode !== "all";
  const loading = queryReport.isLoading || pageReport.isLoading;

  const totals = useMemo(() => totalsOf(scopedPages), [scopedPages]);
  const priorTotals = useMemo(() => priorTotalsOf(scopedPages), [scopedPages]);

  const opportunities = useMemo(
    () =>
      sortByPriority([
        ...ctrOpportunities(communityFiltered ? [] : allQueries, scopedPages, 4),
        ...(communityFiltered ? [] : nearPageOne(allQueries, 3)),
        ...pageOpportunities(scopedPages, 3),
      ]).slice(0, 5),
    [allQueries, scopedPages, communityFiltered],
  );

  const gains = useMemo(
    () =>
      sortByPriority([
        ...(communityFiltered || !queryComparable ? [] : queryGains(allQueries, 4)),
        ...(pageComparable ? pageGains(scopedPages, 3) : []),
      ]).slice(0, 5),
    [allQueries, scopedPages, communityFiltered, queryComparable, pageComparable],
  );

  const declines = useMemo(
    () =>
      sortByPriority([
        ...(communityFiltered || !queryComparable ? [] : queryDeclines(allQueries, 4)),
        ...(pageComparable ? pageDeclines(scopedPages, 3) : []),
      ]).slice(0, 5),
    [allQueries, scopedPages, communityFiltered, queryComparable, pageComparable],
  );

  const movers = useMemo(
    () => (pageComparable ? communityMovers(scopedPages, 5) : []),
    [scopedPages, pageComparable],
  );

  const intents = useMemo(
    () => (communityFiltered ? [] : intentMix(allQueries, queryComparable)),
    [allQueries, queryComparable, communityFiltered],
  );

  const noComparison = "No comparable prior Search Console period is available.";
  const communityNote = communityFiltered
    ? " Query-level insights are hidden while a community filter is active, because query exports carry no URL and cannot be attributed to a community."
    : "";

  const nothingImported =
    queryReport.source === "none" &&
    pageReport.source === "none" &&
    !querySelection.options.length &&
    !pageSelection.options.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Insights"
        description="Rule-based observations from your Search Console data for the selected period. Every insight states the numbers behind it and links to the underlying rows. Search Console is aggregate data: visibility and clicks are reported, never leads, tours or move-ins."
      />

      {loading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : nothingImported ? (
        <EmptyState
          icon={<Lightbulb className="size-6" />}
          title="No Search Console data for this period"
          description="No API rows cover this range and no Queries or Pages export has been imported for it."
        />
      ) : (
        <>
          {queryReport.source === "api" ? (
            <GscSourceNote
              source={queryReport.source}
              coverage={queryReport.coverage}
              period={period}
              comparison={comparisonRange}
              grainLabel="Queries"
            />
          ) : (
            <>
              <GscManualSourceNote grainLabel="Queries" />
              <GscExportNotice
                selection={querySelection}
                grainLabel="Queries"
                period={period}
                value={queryImportId}
                onChange={setQueryImportId}
              />
            </>
          )}
          {pageReport.source === "api" ? (
            <GscSourceNote
              source={pageReport.source}
              coverage={pageReport.coverage}
              period={period}
              comparison={comparisonRange}
              grainLabel="Pages"
            />
          ) : (
            <>
              <GscManualSourceNote grainLabel="Pages" />
              <GscExportNotice
                selection={pageSelection}
                grainLabel="Pages"
                period={period}
                value={pageImportId}
                onChange={setPageImportId}
              />
            </>
          )}

          <div className="panel space-y-3 p-5">
            <p className="eyebrow">Executive summary</p>
            <p className="text-sm text-muted-foreground">
              {formatPeriodLabel(period)}.{" "}
              {pageComparable || queryComparable
                ? "A comparable prior period is available, so change insights are shown."
                : `${noComparison} Gains, declines and community movers are hidden.`}
              {communityNote}
            </p>
            {queryReport.source === "manual" || pageReport.source === "manual" ? (
              <p className="text-[11px] text-muted-foreground/80">{COMPARISON_RULE}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Clicks (mapped pages in scope)"
                value={fmtInt(totals.clicks)}
                footnote={
                  pageComparable
                    ? `Prior period: ${fmtInt(priorTotals.clicks)}`
                    : "No comparable prior period"
                }
              />
              <MetricCard
                label="Impressions"
                value={fmtInt(totals.impressions)}
                footnote={
                  pageComparable
                    ? `Prior period: ${fmtInt(priorTotals.impressions)}`
                    : "No comparable prior period"
                }
              />
              <MetricCard label="CTR" value={fmtPercent(totals.ctr)} />
              <MetricCard
                label="Average position"
                value={fmtPosition(totals.position)}
                footnote="impression weighted"
              />
            </div>
          </div>

          {communityFiltered && !scopedPages.length ? (
            <EmptyState
              icon={<Lightbulb className="size-6" />}
              title="No pages are mapped to the selected community"
              description="Insights for a single community come from URL mapping rules only. Add a rule in Admin → URL Mapping Rules, or switch back to all communities."
            />
          ) : (
            <>
              <Section
                title="Top opportunities"
                description="Highest-value places to work next, ranked by rule, not by model."
                insights={opportunities}
                empty="No rows currently meet the opportunity thresholds for this export."
              />

              <Section
                title="Biggest gains"
                description="Largest measured increases against the comparable prior export."
                insights={gains}
                empty={
                  queryComparable || pageComparable ? "No increases were measured." : noComparison
                }
              />

              <Section
                title="Biggest declines"
                description="Largest measured decreases against the comparable prior export."
                insights={declines}
                empty={
                  queryComparable || pageComparable ? "No decreases were measured." : noComparison
                }
              />

              <Section
                title="Community movers"
                description="Communities whose mapped pages gained or lost visibility. Unmapped pages are never attributed to a community."
                insights={movers}
                empty={pageComparable ? "No mapped community changed measurably." : noComparison}
              />

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Intent trends</h2>
                  <p className="text-xs text-muted-foreground">
                    Query mix using your classification rules only. Unmatched queries stay
                    unclassified rather than being guessed.
                  </p>
                </div>
                {intents.length ? (
                  <div className="panel overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Intent</TableHead>
                          <TableHead className="text-right">Clicks</TableHead>
                          <TableHead className="text-right">Impressions</TableHead>
                          <TableHead className="text-right">Share of clicks</TableHead>
                          <TableHead className="text-right">Prior share</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {intents.map((r) => {
                          const move =
                            r.share !== null && r.prevShare !== null ? r.share - r.prevShare : null;
                          return (
                            <TableRow key={r.key}>
                              <TableCell className="font-medium text-foreground">
                                {r.label}
                              </TableCell>
                              <TableCell className="text-right">{fmtInt(r.clicks)}</TableCell>
                              <TableCell className="text-right">{fmtInt(r.impressions)}</TableCell>
                              <TableCell className="text-right">{fmtPercent(r.share, 1)}</TableCell>
                              <TableCell className="text-right">
                                {queryComparable ? fmtPercent(r.prevShare, 1) : "—"}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right",
                                  move === null
                                    ? "text-muted-foreground"
                                    : move > 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : move < 0
                                        ? "text-destructive"
                                        : "text-muted-foreground",
                                )}
                              >
                                {move === null ? (
                                  "—"
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    {move > 0 ? (
                                      <TrendingUp className="size-3.5" />
                                    ) : move < 0 ? (
                                      <TrendingDown className="size-3.5" />
                                    ) : null}
                                    {`${move > 0 ? "+" : ""}${(move * 100).toFixed(1)} pts`}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="panel px-4 py-3 text-xs text-muted-foreground">
                    {communityFiltered
                      ? "Query exports carry no URL, so intent mix is only available across all communities."
                      : "No query export is available for this period."}
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
