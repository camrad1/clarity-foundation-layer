import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, Globe2 } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { ChartCard, CHART_TOKENS, MetricTrendChart } from "@/components/clarity/charts";
import { SeriesToggleChips, useSeriesVisibility } from "@/components/clarity/series-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommunities } from "@/lib/clarity-queries";
import { formatDateOnly, formatPeriodLabel } from "@/lib/date-ranges";
import { fmtInt, fmtPercent } from "@/lib/gsc/format";
import {
  GA4_SOURCE_LABEL,
  useGa4CommunityTraffic,
  useGa4Dimension,
  useGa4Health,
  useGa4LandingPages,
  useGa4Series,
  useGa4Totals,
  type Ga4CommunityRow,
  type Ga4DimensionRow,
  type Ga4LandingRow,
  type Ga4SeriesPoint,
} from "@/lib/google/ga4-queries";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

/**
 * Marketing Intelligence → Traffic Intelligence.
 *
 * GA4 is the only source on this page. Every number comes from the canonical
 * `ga4_api_facts` grains through security-definer RPCs, so tenant scope, the
 * global date filter and the comparison period apply server-side. Grains are
 * never merged: totals come from `daily_totals`, channel / source-medium /
 * campaign / device come from their own grains, and community traffic comes
 * only from landing pages a deterministic URL rule mapped.
 *
 * Search Console visibility is deliberately absent — the two systems share no
 * record-level identifier, so no impression → session ratio is calculated here.
 */

export const Route = createFileRoute("/_authenticated/marketing/traffic")({
  head: () => ({
    meta: [
      { title: "Traffic Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Google Analytics 4 website traffic: acquisition channels, landing pages, campaigns, devices and community-mapped sessions.",
      },
      {
        property: "og:title",
        content: "Traffic Intelligence — ONELIFE Marketing Performance Hub",
      },
      {
        property: "og:description",
        content: "What website traffic does after people reach the site, straight from GA4.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrafficIntelligence,
});

/* ------------------------------------------------------------------ utils */

const PROPERTY_NOTE =
  "Property-wide GA4 grain. GA4 does not attribute channel, source, campaign or device rows to a landing page, so these tables stay property-wide even when a community is selected.";

/** GA4-native placeholder buckets; these are not real page paths. */
const SPECIAL_BUCKETS = new Set(["(not set)", "(other)", "(none)", "(direct)"]);

function rate(engaged: number, sessions: number): number | null {
  return sessions > 0 ? engaged / sessions : null;
}

function pctOf(value: number, total: number): number | null {
  return total > 0 ? value / total : null;
}

function deltaOf(current: number, previous: number | null | undefined) {
  if (previous == null || previous === 0) return null;
  const d = (current - previous) / previous;
  return {
    label: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}% vs prior`,
    tone: d > 0 ? ("up" as const) : d < 0 ? ("down" as const) : ("neutral" as const),
  };
}

function pointDelta(current: number | null, previous: number | null | undefined) {
  if (current == null || previous == null) return null;
  const d = (current - previous) * 100;
  return {
    label: `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts vs prior`,
    tone: d > 0 ? ("up" as const) : d < 0 ? ("down" as const) : ("neutral" as const),
  };
}

function shortDelta(current: number, previous: number | null | undefined) {
  if (previous == null || previous === 0) return null;
  const d = ((current - previous) / previous) * 100;
  return { value: d, label: `${d >= 0 ? "+" : ""}${d.toFixed(0)}%` };
}

type Grain = "day" | "week" | "month";

function bucketKey(date: string, grain: Grain): { key: string; label: string } {
  if (grain === "day") return { key: date, label: formatDateOnly(date, "MMM d") };
  if (grain === "month") {
    const key = date.slice(0, 7);
    return { key, label: formatDateOnly(`${key}-01`, "MMM yyyy") };
  }
  // ISO-style week starting Monday, computed from the date string only.
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  const key = dt.toISOString().slice(0, 10);
  return { key, label: `Wk of ${formatDateOnly(key, "MMM d")}` };
}

/**
 * Buckets the daily GA4 series. Counts are summed; engagement rate is
 * recomputed from summed engaged sessions ÷ summed sessions so percentages are
 * never averaged across days.
 */
function bucketSeries(points: Ga4SeriesPoint[], grain: Grain) {
  const map = new Map<
    string,
    {
      label: string;
      sessions: number;
      active_users: number;
      new_users: number;
      engaged_sessions: number;
      screen_page_views: number;
    }
  >();
  for (const p of points) {
    if (p.is_partial_day) continue; // never mix a partial day into a completed bucket
    const { key, label } = bucketKey(p.date, grain);
    const e =
      map.get(key) ??
      {
        label,
        sessions: 0,
        active_users: 0,
        new_users: 0,
        engaged_sessions: 0,
        screen_page_views: 0,
      };
    e.sessions += Number(p.sessions ?? 0);
    e.active_users += Number(p.active_users ?? 0);
    e.new_users += Number(p.new_users ?? 0);
    e.engaged_sessions += Number(p.engaged_sessions ?? 0);
    e.screen_page_views += Number(p.screen_page_views ?? 0);
    map.set(key, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({
      ...v,
      engagement_rate_pct: v.sessions ? (v.engaged_sessions / v.sessions) * 100 : 0,
    }));
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

function useSortable<T extends string>(initial: T, initialDir: "asc" | "desc" = "desc") {
  const [key, setKey] = useState<T>(initial);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);
  const toggle = (k: T) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("desc");
    }
  };
  return { key, dir, toggle };
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 text-xs transition-colors hover:text-foreground",
          active ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span> : null}
      </button>
    </TableHead>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- page */

function TrafficIntelligence() {
  const { organizationId, dateRange, comparisonRange, communityScope, setCommunityScope } =
    useAppState();
  const communities = useCommunities(organizationId);
  const period = { start: dateRange.start, end: dateRange.end };

  const authorized = useMemo(
    () => (communities.data ?? []).map((c) => ({ id: c.id, region_id: c.region_id ?? null })),
    [communities.data],
  );
  const selectedIds = useMemo(
    () => resolveSelectedCommunityIds(communityScope, authorized),
    [communityScope, authorized],
  );
  const isPortfolio = communityScope.mode === "all";
  /** null = property-wide totals; a list = mapped landing pages only. */
  const scopeIds = isPortfolio ? null : selectedIds;
  const scopeLabel = isPortfolio
    ? "Property-wide GA4 traffic"
    : selectedIds.length === 1
      ? `Mapped landing-page traffic — ${
          (communities.data ?? []).find((c) => c.id === selectedIds[0])?.name ?? "selected community"
        }`
      : `Mapped landing-page traffic — ${selectedIds.length} communities`;

  const health = useGa4Health(organizationId);
  const totals = useGa4Totals(organizationId, period, scopeIds);
  const prevTotals = useGa4Totals(organizationId, comparisonRange, scopeIds);
  const series = useGa4Series(organizationId, period, scopeIds);

  const channels = useGa4Dimension(organizationId, period, "channel_group", 50);
  const prevChannels = useGa4Dimension(organizationId, comparisonRange, "channel_group", 50);
  const sources = useGa4Dimension(organizationId, period, "source_medium", 250);
  const prevSources = useGa4Dimension(organizationId, comparisonRange, "source_medium", 250);
  const campaigns = useGa4Dimension(organizationId, period, "source_medium_campaign", 100);
  const devices = useGa4Dimension(organizationId, period, "device", 25);

  const landing = useGa4LandingPages(organizationId, period, scopeIds, 300);
  const prevLanding = useGa4LandingPages(organizationId, comparisonRange, scopeIds, 300);
  const byCommunity = useGa4CommunityTraffic(organizationId, period, scopeIds);
  const prevByCommunity = useGa4CommunityTraffic(organizationId, comparisonRange, scopeIds);

  const t = totals.data;
  const p = prevTotals.data;
  const loadingTotals = totals.isLoading || (!!comparisonRange && prevTotals.isLoading);

  /* -------- traffic over time -------- */
  const rangeDays = daysBetween(period.start, period.end);
  const autoGrain: Grain = rangeDays <= 45 ? "day" : rangeDays <= 190 ? "week" : "month";
  const [grainChoice, setGrainChoice] = useState<Grain | "auto">("auto");
  const grain: Grain = grainChoice === "auto" ? autoGrain : grainChoice;
  const trend = useMemo(() => bucketSeries(series.data ?? [], grain), [series.data, grain]);

  const TREND_SERIES = [
    { key: "sessions", label: "Sessions", color: CHART_TOKENS.primary },
    { key: "active_users", label: "Active users", color: CHART_TOKENS.secondary },
    { key: "new_users", label: "New users", color: CHART_TOKENS.tertiary },
    { key: "engaged_sessions", label: "Engaged sessions", color: CHART_TOKENS.quaternary },
    { key: "screen_page_views", label: "Views", color: CHART_TOKENS.muted },
  ];
  const visibility = useSeriesVisibility(
    "clarityiq.ga4.traffic.series",
    TREND_SERIES.map((s) => s.key),
    ["sessions", "active_users"],
  );
  const [focused, setFocused] = useState<string | null>(null);

  /* -------- tables -------- */
  const channelRows = channels.data ?? [];
  const channelTotal = channelRows.reduce((s, r) => s + Number(r.sessions), 0);
  const prevChannelMap = useMemo(
    () => new Map((prevChannels.data ?? []).map((r) => [r.dimension_value, r])),
    [prevChannels.data],
  );

  const sourceSort = useSortable<"sessions" | "active_users" | "new_users" | "engagement_rate">(
    "sessions",
  );
  const [sourceLimit, setSourceLimit] = useState<10 | 25 | 0>(10);
  const sourceRows = sources.data ?? [];
  const sourceTotal = sourceRows.reduce((s, r) => s + Number(r.sessions), 0);
  const prevSourceMap = useMemo(
    () => new Map((prevSources.data ?? []).map((r) => [r.dimension_value, r])),
    [prevSources.data],
  );
  const sortedSources = useMemo(() => {
    const rows = [...sourceRows];
    rows.sort((a, b) => {
      const va = Number(a[sourceSort.key] ?? 0);
      const vb = Number(b[sourceSort.key] ?? 0);
      return sourceSort.dir === "desc" ? vb - va : va - vb;
    });
    return sourceLimit ? rows.slice(0, sourceLimit) : rows;
  }, [sourceRows, sourceSort.key, sourceSort.dir, sourceLimit]);

  const [pageSearch, setPageSearch] = useState("");
  const [mappedOnly, setMappedOnly] = useState(false);
  const landingSort = useSortable<"sessions" | "engagement_rate">("sessions");
  const landingRows = landing.data ?? [];
  const landingTotal = landingRows.reduce((s, r) => s + Number(r.sessions), 0);
  const prevLandingMap = useMemo(
    () => new Map((prevLanding.data ?? []).map((r) => [r.landing_path, r])),
    [prevLanding.data],
  );
  const communityNames = useMemo(
    () => new Map((communities.data ?? []).map((c) => [c.id, c.name as string])),
    [communities.data],
  );
  const filteredLanding = useMemo(() => {
    const term = pageSearch.trim().toLowerCase();
    const rows = landingRows.filter((r) => {
      if (term && !r.landing_path.toLowerCase().includes(term)) return false;
      if (mappedOnly && !r.mapped_community_id) return false;
      return true;
    });
    rows.sort((a, b) => {
      const va = Number(a[landingSort.key] ?? 0);
      const vb = Number(b[landingSort.key] ?? 0);
      return landingSort.dir === "desc" ? vb - va : va - vb;
    });
    return rows.slice(0, 100);
  }, [landingRows, pageSearch, mappedOnly, landingSort.key, landingSort.dir]);

  const communityRows = byCommunity.data ?? [];
  const communityTotal = communityRows.reduce((s, r) => s + Number(r.sessions), 0);
  const prevCommunityMap = useMemo(
    () => new Map((prevByCommunity.data ?? []).map((r) => [r.community_id, r])),
    [prevByCommunity.data],
  );

  const deviceRows = devices.data ?? [];
  const deviceTotal = deviceRows.reduce((s, r) => s + Number(r.sessions), 0);

  /* -------- deterministic observations -------- */
  const observations = useMemo(() => {
    const out: string[] = [];
    if (!t) return out;
    if (p && p.sessions > 0) {
      const sd = ((t.sessions - p.sessions) / p.sessions) * 100;
      const er = (t.engagement_rate ?? 0) - (p.engagement_rate ?? 0);
      if (Math.abs(sd) >= 1)
        out.push(
          `Sessions ${sd >= 0 ? "increased" : "decreased"} ${Math.abs(sd).toFixed(1)}% versus ${formatPeriodLabel(comparisonRange)}${
            Math.abs(er) >= 0.01
              ? `, while engagement rate ${er >= 0 ? "rose" : "fell"} ${Math.abs(er * 100).toFixed(1)} points`
              : ""
          }.`,
        );
    }
    const topChannel = channelRows[0];
    if (topChannel && channelTotal > 0)
      out.push(
        `${topChannel.dimension_value} generated the largest share of sessions (${fmtPercent(
          pctOf(Number(topChannel.sessions), channelTotal),
          1,
        )} of property-wide sessions).`,
      );
    const topSource = sourceRows[0];
    if (topSource && sourceTotal > 0)
      out.push(
        `${topSource.dimension_value} was the largest single source / medium with ${fmtInt(
          Number(topSource.sessions),
        )} sessions.`,
      );
    if (deviceTotal > 0 && deviceRows.length) {
      const top = [...deviceRows].sort((a, b) => Number(b.sessions) - Number(a.sessions))[0]!;
      out.push(
        `${top.dimension_value} accounted for ${fmtPercent(
          pctOf(Number(top.sessions), deviceTotal),
          1,
        )} of sessions in this range.`,
      );
    }
    if (landingRows.length && landingTotal > 0) {
      const top5 = [...landingRows]
        .sort((a, b) => Number(b.sessions) - Number(a.sessions))
        .slice(0, 5)
        .reduce((s, r) => s + Number(r.sessions), 0);
      const share = top5 / landingTotal;
      if (share >= 0.5)
        out.push(
          `The top five landing pages hold ${fmtPercent(share, 1)} of the landing-page sessions in scope.`,
        );
    }
    return out.slice(0, 5);
  }, [
    t,
    p,
    comparisonRange,
    channelRows,
    channelTotal,
    sourceRows,
    sourceTotal,
    deviceRows,
    deviceTotal,
    landingRows,
    landingTotal,
  ]);

  /* -------- deterministic landing-page opportunities -------- */
  const opportunities = useMemo(() => {
    const out: {
      title: string;
      detail: string;
      metrics: string;
      path?: string;
      community?: string | null;
    }[] = [];
    if (!landingRows.length || !landingTotal) return out;
    const overall = t?.engagement_rate ?? null;
    const median =
      [...landingRows].sort((a, b) => Number(b.sessions) - Number(a.sessions))[
        Math.floor(landingRows.length / 2)
      ]?.sessions ?? 0;

    for (const r of [...landingRows].sort((a, b) => Number(b.sessions) - Number(a.sessions))) {
      if (out.length >= 6) break;
      if (SPECIAL_BUCKETS.has(r.landing_path)) continue;
      const sessions = Number(r.sessions);
      if (sessions < Math.max(50, Number(median))) continue;
      const er = r.engagement_rate;
      if (overall != null && er != null && er < overall - 0.1) {
        out.push({
          title: "High traffic, below-average engagement",
          detail: `${r.landing_path} draws meaningful traffic but engages fewer of those sessions than the scope average.`,
          metrics: `${fmtInt(sessions)} sessions · ${fmtPercent(er, 1)} engagement rate vs ${fmtPercent(overall, 1)} overall`,
          path: r.landing_path,
          community: r.mapped_community_id ? (communityNames.get(r.mapped_community_id) ?? null) : null,
        });
        continue;
      }
      const prev = prevLandingMap.get(r.landing_path);
      if (prev && Number(prev.sessions) >= 50) {
        const d = (sessions - Number(prev.sessions)) / Number(prev.sessions);
        if (d <= -0.25)
          out.push({
            title: "Traffic decline versus comparison period",
            detail: `${r.landing_path} received materially fewer sessions than ${formatPeriodLabel(comparisonRange)}.`,
            metrics: `${fmtInt(sessions)} sessions vs ${fmtInt(Number(prev.sessions))} (${(d * 100).toFixed(0)}%)`,
            path: r.landing_path,
            community: r.mapped_community_id ? (communityNames.get(r.mapped_community_id) ?? null) : null,
          });
        else if (d >= 0.5 && r.mapped_community_id)
          out.push({
            title: "Strong growth in mapped community traffic",
            detail: `${r.landing_path} grew sharply versus ${formatPeriodLabel(comparisonRange)}.`,
            metrics: `${fmtInt(sessions)} sessions vs ${fmtInt(Number(prev.sessions))} (+${(d * 100).toFixed(0)}%)`,
            path: r.landing_path,
            community: communityNames.get(r.mapped_community_id) ?? null,
          });
      }
    }
    return out;
  }, [landingRows, landingTotal, t, prevLandingMap, comparisonRange, communityNames]);

  const freshness = health.data;

  if (!totals.isLoading && t && t.days === 0 && !series.data?.length) {
    return (
      <div className="space-y-6">
        <TrafficHeader scopeLabel={scopeLabel} />
        <EmptyState
          icon={<Activity className="size-6" />}
          title="No GA4 traffic for this selection"
          description={
            isPortfolio
              ? "No Google Analytics 4 rows cover the selected date range."
              : "No landing pages mapped to the selected community recorded sessions in this range."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TrafficHeader scopeLabel={scopeLabel} />

      {/* Freshness / provenance — compact; the full panel lives on Data Health. */}
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Globe2 className="size-3.5" /> {GA4_SOURCE_LABEL}
        </span>
        <span>{scopeLabel}</span>
        <span>Selected period: {formatPeriodLabel(period)}</span>
        {comparisonRange ? <span>Compared with {formatPeriodLabel(comparisonRange)}</span> : null}
        {freshness?.last_complete_date ? (
          <span>Latest complete day: {formatDateOnly(freshness.last_complete_date)}</span>
        ) : null}
        {freshness?.partial_date ? (
          <span>
            {formatDateOnly(freshness.partial_date)} is partial and is excluded from completed-period
            comparisons.
          </span>
        ) : null}
        <Link to="/data-health" className="text-brand underline underline-offset-2">
          Data health
        </Link>
      </div>

      {/* 3 — KPI cards */}
      {loadingTotals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Sessions"
            value={fmtInt(t?.sessions ?? null)}
            delta={deltaOf(Number(t?.sessions ?? 0), p?.sessions)}
            footnote={p ? `${fmtInt(p.sessions)} prior` : undefined}
          />
          <MetricCard
            label="Active users"
            value={fmtInt(t?.active_users ?? null)}
            delta={deltaOf(Number(t?.active_users ?? 0), p?.active_users)}
            footnote={p ? `${fmtInt(p.active_users)} prior` : undefined}
          />
          <MetricCard
            label="New users"
            value={fmtInt(t?.new_users ?? null)}
            delta={deltaOf(Number(t?.new_users ?? 0), p?.new_users)}
            footnote={p ? `${fmtInt(p.new_users)} prior` : undefined}
          />
          <MetricCard
            label="Engaged sessions"
            value={fmtInt(t?.engaged_sessions ?? null)}
            delta={deltaOf(Number(t?.engaged_sessions ?? 0), p?.engaged_sessions)}
            footnote={p ? `${fmtInt(p.engaged_sessions)} prior` : undefined}
          />
          <MetricCard
            label="Engagement rate"
            value={fmtPercent(t?.engagement_rate ?? null, 1)}
            delta={pointDelta(t?.engagement_rate ?? null, p?.engagement_rate)}
            footnote="Engaged sessions ÷ sessions"
          />
          <MetricCard
            label="Views"
            value={fmtInt(t?.screen_page_views ?? null)}
            delta={deltaOf(Number(t?.screen_page_views ?? 0), p?.screen_page_views)}
            footnote={p ? `${fmtInt(p.screen_page_views)} prior` : undefined}
          />
        </div>
      )}

      {/* 4 — Traffic over time */}
      <ChartCard
        title="Traffic over time"
        description={`Daily GA4 rows bucketed by ${grain}. Counts are summed; engagement rate is recomputed from engaged sessions ÷ sessions rather than averaging daily percentages. Partial days are excluded.`}
        loading={series.isLoading}
        empty={trend.length ? undefined : "No completed GA4 days in this range."}
        height={320}
        actions={
          <div className="flex gap-1">
            {(["auto", "day", "week", "month"] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={grainChoice === g ? "secondary" : "ghost"}
                onClick={() => setGrainChoice(g)}
                className="h-7 px-2 text-xs capitalize"
              >
                {g === "auto" ? `Auto (${autoGrain})` : g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
              </Button>
            ))}
          </div>
        }
      >
        <div className="flex h-full flex-col gap-3">
          <SeriesToggleChips
            series={TREND_SERIES}
            visible={visibility.visible}
            onToggle={visibility.toggle}
            onHover={setFocused}
          />
          <div className="min-h-0 flex-1">
            <MetricTrendChart
              data={trend}
              series={TREND_SERIES.filter((s) => visibility.visible.includes(s.key))}
              xKey="label"
              focusedKey={focused}
            />
          </div>
        </div>
      </ChartCard>

      {/* 5 — Channel mix */}
      <Panel
        title="Traffic by channel"
        note={PROPERTY_NOTE}
        loading={channels.isLoading}
        empty={!channelRows.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Default channel group</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">% of sessions</TableHead>
              <TableHead className="text-right">Active users</TableHead>
              <TableHead className="text-right">Engaged sessions</TableHead>
              <TableHead className="text-right">Engagement rate</TableHead>
              {comparisonRange ? <TableHead className="text-right">Sessions change</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...channelRows]
              .sort((a, b) => Number(b.sessions) - Number(a.sessions))
              .map((r) => {
                const d = shortDelta(
                  Number(r.sessions),
                  prevChannelMap.get(r.dimension_value)?.sessions,
                );
                return (
                  <TableRow key={r.dimension_value}>
                    <TableCell className="font-medium">{r.dimension_value}</TableCell>
                    <Num>{fmtInt(r.sessions)}</Num>
                    <Num>{fmtPercent(pctOf(Number(r.sessions), channelTotal), 1)}</Num>
                    <Num>{fmtInt(r.active_users)}</Num>
                    <Num>{fmtInt(r.engaged_sessions)}</Num>
                    <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
                    {comparisonRange ? (
                      <Num
                        className={
                          d ? (d.value >= 0 ? "text-success" : "text-destructive") : undefined
                        }
                      >
                        {d?.label ?? "—"}
                      </Num>
                    ) : null}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Panel>

      {/* 6 — Source / medium */}
      <Panel
        title="Source / medium"
        note={`${PROPERTY_NOTE} Source names are shown exactly as GA4 stores them; values that differ only by capitalisation are never merged.`}
        loading={sources.isLoading}
        empty={!sourceRows.length}
        actions={
          <div className="flex gap-1">
            {([10, 25, 0] as const).map((n) => (
              <Button
                key={n}
                size="sm"
                variant={sourceLimit === n ? "secondary" : "ghost"}
                onClick={() => setSourceLimit(n)}
                className="h-7 px-2 text-xs"
              >
                {n === 0 ? `All (${sourceRows.length})` : `Top ${n}`}
              </Button>
            ))}
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source / medium</TableHead>
              <SortHead
                label="Sessions"
                active={sourceSort.key === "sessions"}
                dir={sourceSort.dir}
                onClick={() => sourceSort.toggle("sessions")}
              />
              <TableHead className="text-right">% of sessions</TableHead>
              <SortHead
                label="Active users"
                active={sourceSort.key === "active_users"}
                dir={sourceSort.dir}
                onClick={() => sourceSort.toggle("active_users")}
              />
              <SortHead
                label="New users"
                active={sourceSort.key === "new_users"}
                dir={sourceSort.dir}
                onClick={() => sourceSort.toggle("new_users")}
              />
              <TableHead className="text-right">Engaged sessions</TableHead>
              <SortHead
                label="Engagement rate"
                active={sourceSort.key === "engagement_rate"}
                dir={sourceSort.dir}
                onClick={() => sourceSort.toggle("engagement_rate")}
              />
              {comparisonRange ? <TableHead className="text-right">Sessions change</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSources.map((r) => {
              const d = shortDelta(
                Number(r.sessions),
                prevSourceMap.get(r.dimension_value)?.sessions,
              );
              return (
                <TableRow key={r.dimension_value}>
                  <TableCell className="font-mono text-xs">{r.dimension_value}</TableCell>
                  <Num>{fmtInt(r.sessions)}</Num>
                  <Num>{fmtPercent(pctOf(Number(r.sessions), sourceTotal), 1)}</Num>
                  <Num>{fmtInt(r.active_users)}</Num>
                  <Num>{fmtInt(r.new_users)}</Num>
                  <Num>{fmtInt(r.engaged_sessions)}</Num>
                  <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
                  {comparisonRange ? (
                    <Num
                      className={d ? (d.value >= 0 ? "text-success" : "text-destructive") : undefined}
                    >
                      {d?.label ?? "—"}
                    </Num>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>

      {/* 8 — Landing pages */}
      <Panel
        title="Landing pages"
        note="Landing-page grain. Paths are shown exactly as GA4 records them. Community labels come only from your deterministic URL mapping rules; unmatched pages stay unmapped. Showing the top 100 rows of the current filter."
        loading={landing.isLoading}
        empty={!landingRows.length}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="Filter landing pages"
              className="h-8 w-56 text-xs"
            />
            <Button
              size="sm"
              variant={mappedOnly ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setMappedOnly((v) => !v)}
            >
              Mapped only
            </Button>
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Landing page</TableHead>
              <TableHead>Mapped community</TableHead>
              <SortHead
                label="Sessions"
                active={landingSort.key === "sessions"}
                dir={landingSort.dir}
                onClick={() => landingSort.toggle("sessions")}
              />
              <TableHead className="text-right">% of traffic</TableHead>
              <TableHead className="text-right">Active users</TableHead>
              <TableHead className="text-right">New users</TableHead>
              <TableHead className="text-right">Engaged sessions</TableHead>
              <SortHead
                label="Engagement rate"
                active={landingSort.key === "engagement_rate"}
                dir={landingSort.dir}
                onClick={() => landingSort.toggle("engagement_rate")}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLanding.map((r: Ga4LandingRow) => (
              <TableRow key={`${r.landing_path}-${r.mapped_community_id ?? "none"}`}>
                <TableCell className="max-w-[24rem] truncate font-mono text-xs">
                  {r.landing_path}
                  {SPECIAL_BUCKETS.has(r.landing_path) ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      GA4 bucket, not a page
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {r.mapped_community_id ? (
                    <button
                      type="button"
                      className="text-brand underline underline-offset-2"
                      onClick={() =>
                        setCommunityScope({
                          mode: "communities",
                          communityIds: [r.mapped_community_id!],
                        })
                      }
                    >
                      {communityNames.get(r.mapped_community_id) ?? "Mapped community"}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">Unmapped</span>
                  )}
                </TableCell>
                <Num>{fmtInt(r.sessions)}</Num>
                <Num>{fmtPercent(pctOf(Number(r.sessions), landingTotal), 1)}</Num>
                <Num>{fmtInt(r.active_users)}</Num>
                <Num>{fmtInt(r.new_users)}</Num>
                <Num>{fmtInt(r.engaged_sessions)}</Num>
                <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {/* 9 — Community traffic */}
      {isPortfolio ? (
        <Panel
          title="Traffic by community"
          note="Community traffic represents sessions landing on URLs mapped to each community. It does not include property-wide or unmapped landing pages."
          loading={byCommunity.isLoading}
          empty={!communityRows.length}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Community</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">% of mapped sessions</TableHead>
                <TableHead className="text-right">Active users</TableHead>
                <TableHead className="text-right">New users</TableHead>
                <TableHead className="text-right">Engaged sessions</TableHead>
                <TableHead className="text-right">Engagement rate</TableHead>
                {comparisonRange ? (
                  <TableHead className="text-right">Sessions change</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {communityRows.map((r: Ga4CommunityRow) => {
                const d = shortDelta(
                  Number(r.sessions),
                  prevCommunityMap.get(r.community_id)?.sessions,
                );
                return (
                  <TableRow key={r.community_id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="text-brand underline underline-offset-2"
                        onClick={() =>
                          setCommunityScope({ mode: "communities", communityIds: [r.community_id] })
                        }
                      >
                        {r.community_name}
                      </button>
                    </TableCell>
                    <Num>{fmtInt(r.sessions)}</Num>
                    <Num>{fmtPercent(pctOf(Number(r.sessions), communityTotal), 1)}</Num>
                    <Num>{fmtInt(r.active_users)}</Num>
                    <Num>{fmtInt(r.new_users)}</Num>
                    <Num>{fmtInt(r.engaged_sessions)}</Num>
                    <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
                    {comparisonRange ? (
                      <Num
                        className={
                          d ? (d.value >= 0 ? "text-success" : "text-destructive") : undefined
                        }
                      >
                        {d?.label ?? "—"}
                      </Num>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      ) : (
        <Panel
          title="Community traffic summary"
          note="Sessions landing on URLs mapped to the selected community. Property-wide and unmapped landing pages are excluded."
          loading={byCommunity.isLoading}
          empty={!communityRows.length}
        >
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            {communityRows.map((r) => (
              <div key={r.community_id} className="space-y-1 rounded-lg border border-border p-4">
                <p className="text-sm font-semibold text-foreground">{r.community_name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtInt(r.sessions)} sessions · {fmtInt(r.active_users)} active users
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtPercent(r.engagement_rate, 1)} engagement rate · {fmtInt(r.landing_pages)}{" "}
                  mapped landing pages
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* 7 — Campaigns */}
      <Panel
        title="Campaigns"
        note={`${PROPERTY_NOTE} Campaign names are shown exactly as GA4 stores them. Campaign text is never used to infer a community mapping.`}
        loading={campaigns.isLoading}
        empty={!campaigns.data?.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Source / medium</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Active users</TableHead>
              <TableHead className="text-right">Engaged sessions</TableHead>
              <TableHead className="text-right">Engagement rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(campaigns.data ?? []).map((r: Ga4DimensionRow, i) => (
              <TableRow key={`${r.dimension_value}-${r.secondary_value ?? ""}-${i}`}>
                <TableCell className="font-medium">{r.secondary_value ?? "(not set)"}</TableCell>
                <TableCell className="font-mono text-xs">{r.dimension_value}</TableCell>
                <Num>{fmtInt(r.sessions)}</Num>
                <Num>{fmtInt(r.active_users)}</Num>
                <Num>{fmtInt(r.engaged_sessions)}</Num>
                <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {/* 10 — Device */}
      <Panel
        title="Traffic by device"
        note={PROPERTY_NOTE}
        loading={devices.isLoading}
        empty={!deviceRows.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device category</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">% of sessions</TableHead>
              <TableHead className="text-right">Active users</TableHead>
              <TableHead className="text-right">Engaged sessions</TableHead>
              <TableHead className="text-right">Engagement rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...deviceRows]
              .sort((a, b) => Number(b.sessions) - Number(a.sessions))
              .map((r) => (
                <TableRow key={r.dimension_value}>
                  <TableCell className="font-medium capitalize">{r.dimension_value}</TableCell>
                  <Num>{fmtInt(r.sessions)}</Num>
                  <Num>{fmtPercent(pctOf(Number(r.sessions), deviceTotal), 1)}</Num>
                  <Num>{fmtInt(r.active_users)}</Num>
                  <Num>{fmtInt(r.engaged_sessions)}</Num>
                  <Num>{fmtPercent(r.engagement_rate, 1)}</Num>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Panel>

      {/* 11 / 12 — Observations and opportunities */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-5">
          <h3 className="text-sm font-semibold text-foreground">Traffic observations</h3>
          <p className="text-xs text-muted-foreground">
            Rule-based statements calculated from GA4 only. They describe what the numbers show and
            never assert a cause.
          </p>
          {observations.length ? (
            <ul className="space-y-2 text-sm text-foreground">
              {observations.map((o) => (
                <li key={o} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough GA4 data in this range to state an observation.
            </p>
          )}
        </section>

        <section className="panel space-y-3 p-5">
          <h3 className="text-sm font-semibold text-foreground">Landing-page opportunities</h3>
          <p className="text-xs text-muted-foreground">
            GA4 traffic only. Search ranking opportunities live in{" "}
            <Link to="/marketing/opportunities" className="text-brand underline underline-offset-2">
              Search Console Opportunities
            </Link>
            .
          </p>
          {opportunities.length ? (
            <ul className="space-y-3">
              {opportunities.map((o, i) => (
                <li key={`${o.title}-${o.path}-${i}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{o.title}</p>
                    {o.community ? (
                      <Badge variant="outline" className="text-[10px]">
                        {o.community}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{o.detail}</p>
                  <p className="mt-1 text-xs text-foreground">{o.metrics}</p>
                  {comparisonRange ? (
                    <p className="text-[11px] text-muted-foreground">
                      Comparison period: {formatPeriodLabel(comparisonRange)}
                    </p>
                  ) : null}
                  {o.path ? (
                    <Link
                      to="/marketing/pages"
                      search={{ url: o.path, view: "pages" as const }}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-brand underline underline-offset-2"
                    >
                      Search performance for this page <ArrowUpRight className="size-3" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No landing page met an opportunity rule in this range.
            </p>
          )}
        </section>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        GA4 dimension grains are collected separately and are subject to Google&rsquo;s own sampling
        and cardinality behaviour, so channel, source / medium, campaign, device and landing-page
        totals can differ slightly from property-wide daily totals. Those differences are shown as
        GA4 reports them and are never adjusted to force the grains to tie out. Search Console
        visibility and GA4 traffic share no record-level identifier, so no click-to-session
        conversion is calculated here.
      </p>
    </div>
  );
}

function TrafficHeader({ scopeLabel }: { scopeLabel: string }) {
  return (
    <PageHeader
      eyebrow="Marketing Intelligence"
      title="Traffic Intelligence"
      description={`What website traffic does after people reach the site — acquisition, landing pages, campaigns, devices and community-mapped sessions, straight from Google Analytics 4. ${scopeLabel}.`}
    />
  );
}

function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TableCell className={cn("text-right tabular-nums", className)}>{children}</TableCell>
  );
}

function Panel({
  title,
  note,
  actions,
  loading,
  empty,
  children,
}: {
  title: string;
  note?: string;
  actions?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {note ? (
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{note}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {loading ? (
        <TableSkeleton />
      ) : empty ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No GA4 rows for this selection.</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}
