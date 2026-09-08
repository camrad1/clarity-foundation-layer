import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/clarity/page-header";
import { EmptyState } from "@/components/clarity/empty-state";
import { CHART_TOKENS, MetricTrendChart } from "@/components/clarity/charts";
import { SeriesToggleChips, useSeriesVisibility } from "@/components/clarity/series-toggle";
import { occupancyAxis, visibleValues } from "@/lib/charts/occupancy-axis";
import {
  suggestGrain,
  useCommunityTrendSeries,
  type CommunityTrendRow,
  type TrendGrain,
} from "@/lib/community-trends/queries";
import { useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_authenticated/community-trends")({
  head: () => ({
    meta: [
      { title: "Community Trends — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Compare sales, occupancy and digital engagement trends across every community in one scrolling monitoring board.",
      },
      { property: "og:title", content: "Community Trends — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Twelve-month trend charts for every community, using validated canonical metrics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunityTrends,
});

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const asUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const monthLabel = (iso: string) => MONTH_FMT.format(asUtc(iso));

/** Shared bucket label. Week buckets start Sunday and are labelled by that Sunday. */
function bucketLabel(iso: string, grain: TrendGrain) {
  if (grain === "month") return monthLabel(iso);
  if (grain === "day") return DAY_FMT.format(asUtc(iso));
  return `Wk ${DAY_FMT.format(asUtc(iso))}`;
}

const GRAINS: { key: TrendGrain; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const OCC_NOTE: Record<TrendGrain, string> = {
  day: "Occupancy % (that day)",
  week: "Occupancy % (end of week)",
  month: "Occupancy % (end of month)",
};

const STORAGE_KEY = "clarityiq.chart.community-trends";


type MetricDef = {
  key: string;
  label: string;
  color: string;
  group: "sales" | "digital" | "occupancy";
  provisional?: boolean;
};

/** Every metric here already exists as a validated canonical metric elsewhere. */
const METRICS: MetricDef[] = [
  { key: "inquiries", label: "New inquiries", color: CHART_TOKENS.primary, group: "sales" },
  { key: "tours", label: "Completed tours", color: CHART_TOKENS.secondary, group: "sales" },
  { key: "re_tours", label: "Re-tours", color: "var(--chart-4)", group: "sales" },
  {
    key: "deposits",
    label: "Deposits",
    color: CHART_TOKENS.provisional,
    group: "sales",
    provisional: true,
  },
  { key: "move_ins", label: "Move-ins", color: CHART_TOKENS.tertiary, group: "sales" },
  { key: "move_outs", label: "Move-outs", color: CHART_TOKENS.quaternary, group: "sales" },
  { key: "net_move_ins", label: "Net move-ins", color: "var(--chart-5)", group: "sales" },
  { key: "occupancy_pct", label: "Occupancy %", color: CHART_TOKENS.primary, group: "occupancy" },
  { key: "sessions", label: "Website sessions", color: CHART_TOKENS.secondary, group: "digital" },
  { key: "engaged_sessions", label: "Engaged sessions", color: CHART_TOKENS.tertiary, group: "digital" },
  { key: "further_leads", label: "Further leads", color: "var(--chart-4)", group: "digital" },
];

const DEFAULTS = ["inquiries", "tours", "move_ins"];

type SortMode = "az" | "occupancy" | "inquiries" | "tours" | "move_ins";

const SORTS: { key: SortMode; label: string }[] = [
  { key: "az", label: "A–Z" },
  { key: "occupancy", label: "Occupancy lowest" },
  { key: "inquiries", label: "Inquiries lowest" },
  { key: "tours", label: "Tours lowest" },
  { key: "move_ins", label: "Move-ins lowest" },
];

function CommunityTrends() {
  const { organizationId, dateRange, setCommunityScope } = useAppState();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortMode>("az");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  // Granularity is independent of the metric toggles: changing one never
  // changes the other. Auto-suggested from the selected range until the user
  // picks a granularity, then their choice is kept for the session.
  const suggested = suggestGrain(dateRange.start, dateRange.end);
  const [chosenGrain, setChosenGrain] = useState<TrendGrain | null>(null);
  const grain: TrendGrain = chosenGrain ?? suggested;
  const chosenRef = useRef(chosenGrain);
  useEffect(() => {
    chosenRef.current = chosenGrain;
  }, [chosenGrain]);

  // Month keeps the validated 12-month monitoring window ending on the
  // selected period; day/week follow the selected range exactly.
  const { start, end } = useMemo(() => {
    const end = dateRange.end.slice(0, 10);
    if (grain !== "month") return { start: dateRange.start.slice(0, 10), end };
    const d = asUtc(end);
    const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1));
    return { start: s.toISOString().slice(0, 10), end };
  }, [dateRange.start, dateRange.end, grain]);

  const matrix = useCommunityTrendSeries(organizationId, start, end, grain);

  const { communities, buckets } = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; rows: CommunityTrendRow[] }>();
    const bucketSet = new Set<string>();
    for (const r of matrix.data ?? []) {
      const entry = byId.get(r.community_id) ?? {
        id: r.community_id,
        name: r.community_name,
        rows: [] as CommunityTrendRow[],
      };
      entry.rows.push(r);
      byId.set(r.community_id, entry);
      bucketSet.add(r.bucket.slice(0, 10));
    }
    // Shared x-axis: identical buckets for every community card.
    const buckets = [...bucketSet].sort();
    const list = [...byId.values()];
    for (const c of list) c.rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
    const latest = (c: (typeof list)[number]) => c.rows[c.rows.length - 1];
    const num = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);
    list.sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      const la = latest(a);
      const lb = latest(b);
      const pick = (r: CommunityTrendRow | undefined) => {
        if (!r) return Number.POSITIVE_INFINITY;
        if (sort === "occupancy") return num(r.occupancy_pct);
        if (sort === "inquiries") return num(r.inquiries);
        if (sort === "tours") return num(r.tours);
        return num(r.move_ins);
      };
      return pick(la) - pick(lb) || a.name.localeCompare(b.name);
    });
    return { communities: list, buckets };
  }, [matrix.data, sort]);

  // Metric visibility is stored separately from granularity, so switching
  // Day / Week / Month never turns series on or off.
  const { visible, toggle } = useSeriesVisibility(
    STORAGE_KEY,
    METRICS.map((m) => m.key),
    DEFAULTS,
  );


  const openSales = (communityId: string) => {
    setCommunityScope({ mode: "communities", communityIds: [communityId] });
    void navigate({ to: "/sales" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portfolio performance"
        title="Community Trends"
        description="Compare sales, occupancy and digital engagement trends across every community in one view."
      />

      <div className="sticky top-16 z-10 -mx-2 rounded-lg border border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SeriesToggleChips
            series={METRICS}
            visible={visible}
            onToggle={toggle}
            onHover={setFocusedKey}
          />
          <div className="flex items-center gap-1.5">
            <span className="eyebrow text-muted-foreground">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  sort === s.key
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-muted-foreground/70 hover:text-muted-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Each chart scales independently for readability. Compare trend direction and movement rather
          than line height between communities. Counts, website traffic and occupancy % are plotted
          separately so units are never mixed on one scale.
        </p>
      </div>

      {matrix.error ? (
        <EmptyState
          title="Community trends could not be loaded"
          description={(matrix.error as Error).message}
        />
      ) : matrix.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel h-[260px] animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : communities.length === 0 ? (
        <EmptyState
          title="No communities available"
          description="No authorized communities were found for the selected organization."
        />
      ) : (
        <div className="space-y-4">
          {communities.map((c) => (
            <CommunityCard
              key={c.id}
              name={c.name}
              rows={c.rows}
              visible={visible}
              focusedKey={focusedKey}
              onOpen={() => openSales(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommunityCard({
  name,
  rows,
  visible,
  focusedKey,
  onOpen,
}: {
  name: string;
  rows: CommunityTrendRow[];
  visible: string[];
  focusedKey: string | null;
  onOpen: () => void;
}) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        label: monthLabel(r.month),
        inquiries: r.inquiries,
        tours: r.tours,
        re_tours: r.re_tours,
        deposits: r.deposits,
        move_ins: r.move_ins,
        move_outs: r.move_outs,
        net_move_ins: r.net_move_ins,
        sessions: r.sessions,
        engaged_sessions: r.engaged_sessions,
        further_leads: r.further_leads,
        occupancy_pct: r.occupancy_pct,
      })),
    [rows],
  );

  const latest = rows[rows.length - 1];
  const salesSeries = METRICS.filter((m) => m.group === "sales" && visible.includes(m.key));
  const digitalSeries = METRICS.filter((m) => m.group === "digital" && visible.includes(m.key));
  const showOccupancy = visible.includes("occupancy_pct");

  const occAxis = useMemo(
    () => occupancyAxis(visibleValues(data, ["occupancy_pct"]), "percent"),
    [data],
  );

  const summary: string[] = [];
  if (latest) {
    summary.push(`${latest.inquiries} inquiries`);
    summary.push(`${latest.tours} tours`);
    summary.push(`${latest.move_ins} move-ins`);
    summary.push(`${latest.net_move_ins >= 0 ? "+" : ""}${latest.net_move_ins} net`);
    if (latest.occupancy_pct != null) summary.push(`${latest.occupancy_pct.toFixed(1)}% occupancy`);
    if (latest.sessions > 0) summary.push(`${latest.sessions.toLocaleString()} sessions`);
  }

  const toSeries = (defs: MetricDef[]) =>
    defs.map((m) => ({
      key: m.key,
      label: m.provisional ? `${m.label} (provisional)` : m.label,
      color: m.color,
      dashed: m.key === "deposits",
    }));

  return (
    <section className="panel space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-left font-display text-base font-semibold tracking-tight hover:underline"
        >
          {name}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          View detail →
        </button>
      </div>
      {latest ? (
        <p className="text-xs text-muted-foreground">
          {monthLabel(latest.month)} · {summary.join(" · ")}
        </p>
      ) : null}

      {salesSeries.length ? (
        <div className="h-[180px]">
          <MetricTrendChart data={data} series={toSeries(salesSeries)} focusedKey={focusedKey} />
        </div>
      ) : null}

      {digitalSeries.length ? (
        <div className="space-y-1">
          <p className="eyebrow text-muted-foreground">Website &amp; digital</p>
          <div className="h-[150px]">
            <MetricTrendChart data={data} series={toSeries(digitalSeries)} focusedKey={focusedKey} />
          </div>
        </div>
      ) : null}

      {showOccupancy ? (
        <div className="space-y-1">
          <p className="eyebrow text-muted-foreground">Occupancy % (end of month)</p>
          <div className="h-[150px]">
            <MetricTrendChart
              data={data}
              series={[{ key: "occupancy_pct", label: "Occupancy %", color: CHART_TOKENS.primary }]}
              yDomain={occAxis.domain}
              yTicks={occAxis.ticks}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              focusedKey={focusedKey}
            />
          </div>
        </div>
      ) : null}

      {!salesSeries.length && !digitalSeries.length && !showOccupancy ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Select at least one metric above to plot this community.
        </p>
      ) : null}
    </section>
  );
}
