import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarClock, Download, Search } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/clarity/empty-state";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMPARISON_MODES, change, formatPeriod, resolveComparison, type ComparisonMode } from "@/lib/gsc/compare";
import { downloadCsv, fmtDelta, fmtInt, fmtPercent, fmtPosition, toCsv } from "@/lib/gsc/format";
import { useDailySeries, useDailyTotals } from "@/lib/gsc/queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/marketing/")({
  head: () => ({
    meta: [
      { title: "Search Overview — ClarityIQ" },
      {
        name: "description",
        content:
          "Daily organic clicks, impressions, click-through rate and average position from Search Console imports.",
      },
      { property: "og:title", content: "Search Overview — ClarityIQ" },
      {
        property: "og:description",
        content: "Trustworthy daily search totals with honest period comparisons.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchOverview,
});

function SearchOverview() {
  const { organizationId, dateRange, communityScope } = useAppState();
  const [mode, setMode] = useState<ComparisonMode>("prior_period");

  const period = { start: dateRange.start, end: dateRange.end };
  const comparison = useMemo(() => resolveComparison(period, mode), [period.start, period.end, mode]);

  const totals = useDailyTotals(organizationId, period);
  const prior = useDailyTotals(organizationId, comparison);
  const series = useDailySeries(organizationId, period);

  const current = totals.data as
    | {
        clicks: number;
        impressions: number;
        ctr: number | null;
        avg_position: number | null;
        days: number;
        first_date: string | null;
        last_date: string | null;
      }
    | null
    | undefined;
  const previous = prior.data as typeof current;

  const hasData = !!current && current.impressions + current.clicks > 0;
  const comparable = !!previous && previous.impressions + previous.clicks > 0;

  const clickDelta = comparable ? change(current!.clicks, previous!.clicks).percent : null;
  const imprDelta = comparable ? change(current!.impressions, previous!.impressions).percent : null;
  const ctrDelta = comparable ? change(current!.ctr, previous!.ctr).percent : null;
  const posDelta = comparable ? change(current!.avg_position, previous!.avg_position).percent : null;

  const rows = (series.data ?? []) as {
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    avg_position: number;
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Search Overview"
        description="Daily totals from the Dates report of your Search Console exports. Click-through rate is recalculated from clicks and impressions, and average position is impression weighted — never a simple average of averages."
        actions={
          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as ComparisonMode)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPARISON_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `clarityiq-search-daily-${period.start}-${period.end}.csv`,
                  toCsv(
                    ["Date", "Clicks", "Impressions", "CTR", "Average position"],
                    rows.map((r) => [r.date, r.clicks, r.impressions, r.ctr, r.avg_position]),
                  ),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </div>
        }
      />

      {communityScope.mode !== "all" ? (
        <p className="panel px-4 py-3 text-xs text-muted-foreground">
          The Search Console Dates report has no page dimension, so it cannot be split by community.
          These totals cover the whole property regardless of the community filter. Use Page
          Intelligence for community-level search performance.
        </p>
      ) : null}

      {totals.isLoading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !hasData ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="No Search Console data for this period"
          description="Import a Search Console export that covers this date range from Admin → Search Console Imports. Nothing is estimated or back-filled."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Clicks" value={fmtInt(current!.clicks)} delta={comparable ? fmtDelta(clickDelta) : null} />
            <MetricCard
              label="Impressions"
              value={fmtInt(current!.impressions)}
              delta={comparable ? fmtDelta(imprDelta) : null}
            />
            <MetricCard label="CTR" value={fmtPercent(current!.ctr)} delta={comparable ? fmtDelta(ctrDelta) : null} />
            <MetricCard
              label="Average position"
              value={fmtPosition(current!.avg_position)}
              delta={comparable ? fmtDelta(posDelta, { invert: true }) : null}
              footnote="lower is better"
            />
          </div>

          <div className="panel flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" />
              Data present for {current!.days} day(s):{" "}
              {current!.first_date ? format(parseISO(current!.first_date), "MMM d, yyyy") : "—"} –{" "}
              {current!.last_date ? format(parseISO(current!.last_date), "MMM d, yyyy") : "—"}
            </span>
            <span>
              Compared with {formatPeriod(comparison)}
              {comparable ? "" : " — no imported data in that period"}
            </span>
          </div>

          <div className="panel p-5">
            <p className="eyebrow pb-4">Clicks and impressions by day</p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => format(parseISO(v), "MMM d")}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => format(parseISO(String(v)), "EEE, MMM d yyyy")}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="clicks"
                    name="Clicks"
                    stroke="var(--primary)"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="impressions"
                    name="Impressions"
                    stroke="var(--muted-foreground)"
                    dot={false}
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
