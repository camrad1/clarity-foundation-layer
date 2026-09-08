import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { ChartCard, CHART_TOKENS, MetricTrendChart } from "@/components/clarity/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useWhLabelMaps } from "@/lib/wh/use-wh";
import { useWhConnection } from "@/lib/wh/queries";
import {
  ADS_SOURCE_LABEL,
  WH_SOURCE_LABEL,
  changeDelta,
  costPer,
  fmtMoney,
  useAdsPaidReport,
  usePaidLeadSources,
  useWhPaidOutcomes,
  type AdsCampaignRow,
  type AdsSeriesPoint,
} from "@/lib/google/paid-media";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

/**
 * Marketing Intelligence → Paid Media Intelligence.
 *
 * Google Ads is canonical for spend and ad performance. WelcomeHome is
 * canonical for inquiries, completed tours and move-ins. The two are never
 * joined at record level — the CRM carries no campaign identifier — so every
 * cost-per-outcome figure here is a paid-media *associated* efficiency measure
 * at community + period + approved paid lead-source level. Nothing on this page
 * is labelled ROI or ROAS.
 */

export const Route = createFileRoute("/_authenticated/marketing/paid-media")({
  head: () => ({
    meta: [
      { title: "Paid Media Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Google Ads spend, efficiency and paid-media associated WelcomeHome inquiries, tours and move-ins by community.",
      },
      {
        property: "og:title",
        content: "Paid Media Intelligence — ONELIFE Marketing Performance Hub",
      },
      {
        property: "og:description",
        content: "What paid search costs and what it is associated with downstream.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaidMediaIntelligence,
});

type Grain = "day" | "week" | "month";

function bucketKey(date: string, grain: Grain): { key: string; label: string } {
  if (grain === "day") return { key: date, label: formatDateOnly(date, "MMM d") };
  if (grain === "month") {
    const key = date.slice(0, 7);
    return { key, label: formatDateOnly(`${key}-01`, "MMM yyyy") };
  }
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  const key = dt.toISOString().slice(0, 10);
  return { key, label: `Wk of ${formatDateOnly(key, "MMM d")}` };
}

function bucketSeries(points: AdsSeriesPoint[], grain: Grain) {
  const map = new Map<
    string,
    { label: string; spend: number; clicks: number; impressions: number; conversions: number }
  >();
  for (const p of points) {
    const { key, label } = bucketKey(p.date, grain);
    const e =
      map.get(key) ?? { label, spend: 0, clicks: 0, impressions: 0, conversions: 0 };
    e.spend += Number(p.spend ?? 0);
    e.clicks += Number(p.clicks ?? 0);
    e.impressions += Number(p.impressions ?? 0);
    e.conversions += Number(p.conversions ?? 0);
    map.set(key, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({ ...v, spend: Number(v.spend.toFixed(2)) }));
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

function useSortable<T extends string>(initial: T) {
  const [key, setKey] = useState<T>(initial);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function PaidMediaIntelligence() {
  const { organizationId, dateRange, comparisonRange, communityScope } = useAppState();
  const communities = useCommunities(organizationId);
  const period = { start: dateRange.start, end: dateRange.end };

  const authorized = useMemo(
    () =>
      (communities.data ?? []).map((c: any) => ({
        id: c.id as string,
        region_id: (c.region_id as string | null) ?? null,
      })),
    [communities.data],
  );
  const scoped = communityScope.mode !== "all";
  // In "all" mode we deliberately send no community list so the report uses
  // whole-account Google Ads spend instead of only mapped campaigns.
  const communityIds = useMemo(
    () => (scoped ? resolveSelectedCommunityIds(communityScope, authorized) : null),
    [scoped, communityScope, authorized],
  );
  const communityNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of communities.data ?? []) map[(c as any).id] = (c as any).name;
    return map;
  }, [communities.data]);

  const ads = useAdsPaidReport(organizationId, period, communityIds);
  const adsPrev = useAdsPaidReport(organizationId, comparisonRange, communityIds);
  const wh = useWhPaidOutcomes(organizationId, period, communityIds);
  const whPrev = useWhPaidOutcomes(organizationId, comparisonRange, communityIds);
  const paidSources = usePaidLeadSources(organizationId);
  const whConn = useWhConnection(organizationId);
  const labels = useWhLabelMaps(whConn.data?.id ?? null);

  const loading = ads.isLoading || wh.isLoading;
  const t = ads.data?.totals ?? null;
  const tPrev = adsPrev.data?.totals ?? null;

  const spend = t ? Number(t.spend) : null;
  const spendPrev = tPrev ? Number(tPrev.spend) : null;
  const clicks = t ? Number(t.clicks) : null;
  const impressions = t ? Number(t.impressions) : null;
  const ctr = t && Number(t.impressions) > 0 ? Number(t.clicks) / Number(t.impressions) : null;
  const ctrPrev =
    tPrev && Number(tPrev.impressions) > 0 ? Number(tPrev.clicks) / Number(tPrev.impressions) : null;
  const cpc = t && Number(t.clicks) > 0 ? Number(t.spend) / Number(t.clicks) : null;
  const cpcPrev = tPrev && Number(tPrev.clicks) > 0 ? Number(tPrev.spend) / Number(tPrev.clicks) : null;

  const cpi = costPer(spend, wh.data?.inquiries ?? null);
  const cpiPrev = costPer(spendPrev, whPrev.data?.inquiries ?? null);
  const cpt = costPer(spend, wh.data?.tours ?? null);
  const cptPrev = costPer(spendPrev, whPrev.data?.tours ?? null);
  const cpm = costPer(spend, wh.data?.moveIns ?? null);
  const cpmPrev = costPer(spendPrev, whPrev.data?.moveIns ?? null);

  const days = daysBetween(period.start, period.end);
  const grain: Grain = days <= 45 ? "day" : days <= 200 ? "week" : "month";
  const series = useMemo(() => bucketSeries(ads.data?.series ?? [], grain), [ads.data, grain]);

  const campaignSort = useSortable<"spend" | "clicks" | "impressions" | "conversions" | "name">(
    "spend",
  );
  const campaigns = useMemo(() => {
    const rows = [...(ads.data?.campaigns ?? [])];
    const dir = campaignSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (campaignSort.key === "name")
        return dir * (a.campaignName ?? "").localeCompare(b.campaignName ?? "");
      return dir * (Number((a as any)[campaignSort.key]) - Number((b as any)[campaignSort.key]));
    });
    return rows;
  }, [ads.data, campaignSort.key, campaignSort.dir]);

  const whByCommunity = useMemo(() => {
    const map: Record<string, { inquiries: number; tours: number; moveIns: number }> = {};
    for (const r of wh.data?.byCommunity ?? [])
      map[r.communityId] = { inquiries: r.inquiries, tours: r.tours, moveIns: r.moveIns };
    return map;
  }, [wh.data]);

  const communityRows = useMemo(() => {
    const ids = new Set<string>();
    for (const r of ads.data?.byCommunity ?? []) ids.add(r.communityId);
    for (const id of Object.keys(whByCommunity)) ids.add(id);
    return [...ids]
      .map((id) => {
        const a = (ads.data?.byCommunity ?? []).find((r) => r.communityId === id);
        const w = whByCommunity[id];
        const s = a ? Number(a.spend) : 0;
        return {
          id,
          name: communityNames[id] ?? a?.communityName ?? "Unknown community",
          spend: s,
          clicks: a ? Number(a.clicks) : 0,
          adsConversions: a ? Number(a.conversions) : 0,
          inquiries: w?.inquiries ?? 0,
          tours: w?.tours ?? 0,
          moveIns: w?.moveIns ?? 0,
          cpi: costPer(s, w?.inquiries ?? 0),
          cpt: costPer(s, w?.tours ?? 0),
          cpm: costPer(s, w?.moveIns ?? 0),
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [ads.data, whByCommunity, communityNames]);

  const includedSources = (paidSources.data ?? []).filter((s) => s.include_in_google_ads_cost);
  const excludedSources = (paidSources.data ?? []).filter((s) => !s.include_in_google_ads_cost);

  const [showMethod, setShowMethod] = useState(false);

  if (!organizationId) {
    return <EmptyState title="Select an organization" description="Choose an organization to view paid media." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paid Media Intelligence"
        description={`Google Ads spend and efficiency alongside the WelcomeHome outcomes paid media is associated with — ${formatPeriodLabel(dateRange)}.`}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{ADS_SOURCE_LABEL}</Badge>
        <Badge variant="outline">{WH_SOURCE_LABEL}</Badge>
        {ads.data?.health?.currency ? (
          <span>
            {ads.data.health.currency} · {ads.data.health.timeZone} · ads data through{" "}
            {ads.data.health.latestDate ? formatDateOnly(ads.data.health.latestDate, "MMM d, yyyy") : "—"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Spend"
            value={fmtMoney(spend, true)}
            delta={changeDelta(spend, spendPrev, { invert: true })}
            footnote="Google Ads"
          />
          <MetricCard
            label="Impressions"
            value={fmtInt(impressions)}
            delta={changeDelta(impressions, tPrev ? Number(tPrev.impressions) : null)}
            footnote="Google Ads"
          />
          <MetricCard
            label="Clicks"
            value={fmtInt(clicks)}
            delta={changeDelta(clicks, tPrev ? Number(tPrev.clicks) : null)}
            footnote="Google Ads"
          />
          <MetricCard
            label="CTR"
            value={fmtPercent(ctr)}
            delta={changeDelta(ctr, ctrPrev)}
            footnote="Clicks ÷ impressions"
          />
          <MetricCard
            label="Avg CPC"
            value={fmtMoney(cpc, true)}
            delta={changeDelta(cpc, cpcPrev, { invert: true })}
            footnote="Spend ÷ clicks"
          />
          <MetricCard
            label="Google Ads conversions"
            value={t ? Number(t.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
            delta={changeDelta(t ? Number(t.conversions) : null, tPrev ? Number(tPrev.conversions) : null)}
            footnote="Platform-reported, not CRM"
          />
          <MetricCard
            label="Cost per WH inquiry (associated)"
            value={fmtMoney(cpi, true)}
            delta={changeDelta(cpi, cpiPrev, { invert: true })}
            footnote={`${fmtMoney(spend)} ÷ ${fmtInt(wh.data?.inquiries ?? null)} paid-source inquiries`}
          />
          <MetricCard
            label="Cost per WH tour (associated)"
            value={fmtMoney(cpt, true)}
            delta={changeDelta(cpt, cptPrev, { invert: true })}
            footnote={`${fmtMoney(spend)} ÷ ${fmtInt(wh.data?.tours ?? null)} paid-source tours`}
          />
          <MetricCard
            label="Cost per WH move-in (associated)"
            value={fmtMoney(cpm, true)}
            delta={changeDelta(cpm, cpmPrev, { invert: true })}
            footnote={`${fmtMoney(spend)} ÷ ${fmtInt(wh.data?.moveIns ?? null)} paid-source move-ins`}
          />
        </div>
      )}

      <div className="panel space-y-2 p-5">
        <p className="text-sm font-medium">Paid-media associated cost efficiency</p>
        <Note>
          WelcomeHome records no campaign identifier, so these cost figures divide Google Ads spend
          by WelcomeHome outcomes whose recorded lead source an administrator classified as paid.
          They describe association at community and period level — not campaign-generated
          conversions, revenue or return on investment.
        </Note>
        {scoped ? (
          <Note>
            A community is selected, so spend comes only from campaigns explicitly mapped to it and
            outcomes only from that community's prospects.
          </Note>
        ) : (
          <Note>
            All communities selected: spend is the whole Google Ads account and outcomes cover every
            community you can access.
          </Note>
        )}
        {ads.data && Number(ads.data.unmapped.spend) > 0 ? (
          <p className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {fmtMoney(Number(ads.data.unmapped.spend), true)} of spend sits on campaigns with no
              approved community mapping. It is never redistributed across communities.
            </span>
          </p>
        ) : null}
      </div>

      <ChartCard
        title="Spend and clicks over time"
        description={`Google Ads, by ${grain}.`}
        loading={loading}
        empty={series.length ? undefined : <EmptyState title="No Google Ads data in this period" />}
        height={300}
      >
        <div style={{ height: 300 }}>
          <MetricTrendChart
            data={series}
            series={[
              { key: "spend", label: "Spend", color: CHART_TOKENS.primary },
              { key: "clicks", label: "Clicks", color: CHART_TOKENS.secondary },
              { key: "conversions", label: "Ads conversions", color: CHART_TOKENS.tertiary },
            ]}
          />
        </div>
      </ChartCard>

      <section className="panel overflow-hidden">
        <div className="space-y-1 p-5">
          <h2 className="text-sm font-semibold">Campaigns</h2>
          <p className="text-xs text-muted-foreground">
            Campaign IDs and names exactly as Google Ads reports them, with the approved community
            mapping.
          </p>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : campaigns.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-muted-foreground">No campaign spend in this period.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="thead-brand hover:bg-brand-light">
                <SortHead
                  label="Campaign"
                  align="left"
                  active={campaignSort.key === "name"}
                  dir={campaignSort.dir}
                  onClick={() => campaignSort.toggle("name")}
                />
                <TableHead>Community</TableHead>
                <TableHead>Status</TableHead>
                <SortHead
                  label="Spend"
                  active={campaignSort.key === "spend"}
                  dir={campaignSort.dir}
                  onClick={() => campaignSort.toggle("spend")}
                />
                <SortHead
                  label="Impressions"
                  active={campaignSort.key === "impressions"}
                  dir={campaignSort.dir}
                  onClick={() => campaignSort.toggle("impressions")}
                />
                <SortHead
                  label="Clicks"
                  active={campaignSort.key === "clicks"}
                  dir={campaignSort.dir}
                  onClick={() => campaignSort.toggle("clicks")}
                />
                <SortHead
                  label="Ads conv."
                  active={campaignSort.key === "conversions"}
                  dir={campaignSort.dir}
                  onClick={() => campaignSort.toggle("conversions")}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c: AdsCampaignRow) => (
                <TableRow key={c.campaignId} className="odd:bg-brand-soft/60 hover:bg-brand-light/70">
                  <TableCell>
                    <div className="font-medium">{c.campaignName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">ID {c.campaignId}</div>
                  </TableCell>
                  <TableCell>
                    {c.communityId ? (
                      communityNames[c.communityId] ?? c.communityName ?? "—"
                    ) : (
                      <Badge variant="outline">Unmapped</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.status ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtMoney(Number(c.spend), true)}</TableCell>
                  <TableCell className="text-right">{fmtInt(Number(c.impressions))}</TableCell>
                  <TableCell className="text-right">{fmtInt(Number(c.clicks))}</TableCell>
                  <TableCell className="text-right">
                    {Number(c.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="space-y-1 p-5">
          <h2 className="text-sm font-semibold">Spend and associated outcomes by community</h2>
          <p className="text-xs text-muted-foreground">
            Spend from mapped campaigns; inquiries, tours and move-ins from WelcomeHome paid lead
            sources. Separate systems, matched only on community and period.
          </p>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : communityRows.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-muted-foreground">Nothing to show for this period.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="thead-brand hover:bg-brand-light">
                <TableHead>Community</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Inquiries</TableHead>
                <TableHead className="text-right">Tours</TableHead>
                <TableHead className="text-right">Move-ins</TableHead>
                <TableHead className="text-right">Cost / inquiry</TableHead>
                <TableHead className="text-right">Cost / tour</TableHead>
                <TableHead className="text-right">Cost / move-in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {communityRows.map((r) => (
                <TableRow key={r.id} className="odd:bg-brand-soft/60 hover:bg-brand-light/70">
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.spend, true)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.clicks)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.inquiries)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.tours)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.moveIns)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.cpi, true)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.cpt, true)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.cpm, true)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="space-y-1 p-5">
            <h2 className="text-sm font-semibold">Devices</h2>
            <p className="text-xs text-muted-foreground">
              Account-wide Google Ads device grain. Google Ads does not tie device rows to a
              community mapping, so this stays account-wide.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="thead-brand hover:bg-brand-light">
                <TableHead>Device</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Ads conv.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ads.data?.devices ?? []).map((d) => (
                <TableRow key={d.device} className="odd:bg-brand-soft/60">
                  <TableCell>{d.device}</TableCell>
                  <TableCell className="text-right">{fmtMoney(Number(d.spend), true)}</TableCell>
                  <TableCell className="text-right">{fmtInt(Number(d.clicks))}</TableCell>
                  <TableCell className="text-right">
                    {Number(d.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="panel overflow-hidden">
          <div className="space-y-1 p-5">
            <h2 className="text-sm font-semibold">Google Ads conversion actions</h2>
            <p className="text-xs text-muted-foreground">
              Platform-reported conversions, account-wide. These are not WelcomeHome inquiries and
              are never counted as CRM outcomes.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="thead-brand hover:bg-brand-light">
                <TableHead>Action</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ads.data?.conversionActions ?? []).map((a) => (
                <TableRow key={a.actionId} className="odd:bg-brand-soft/60">
                  <TableCell>{a.name ?? a.actionId}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.category ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {Number(a.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">How these numbers are built</h2>
          <Button variant="ghost" size="sm" onClick={() => setShowMethod((v) => !v)}>
            {showMethod ? "Hide" : "Show"}
          </Button>
        </div>
        {showMethod ? (
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Spend and ad performance</strong> come from the
              Google Ads API fact layer for the selected account, in the account time zone
              (America/Los_Angeles) and currency (USD). Dates are calendar dates and are never
              shifted.
            </p>
            <p>
              <strong className="text-foreground">Community attribution of spend</strong> uses only
              the explicit campaign → community mapping approved in Admin. There is no fuzzy name
              matching, and unmapped spend is reported separately rather than shared out.
            </p>
            <p>
              <strong className="text-foreground">Inquiries, tours and move-ins</strong> use the
              existing WelcomeHome definitions unchanged, restricted to prospects whose recorded
              lead source is on the approved paid list:{" "}
              {includedSources.length
                ? includedSources.map((s) => s.lead_source_label).join(", ")
                : "none approved yet"}
              .
              {excludedSources.length
                ? ` Other paid sources are tracked but excluded from Google Ads cost efficiency: ${excludedSources
                    .map((s) => s.lead_source_label)
                    .join(", ")}.`
                : ""}
            </p>
            <p>
              <strong className="text-foreground">Limitations.</strong> No record-level campaign
              attribution exists in the CRM, deposits are excluded here because they remain
              provisional, and Google Ads conversions are platform-reported and overlap unknown
              amounts with CRM outcomes. Nothing here is revenue, ROI or ROAS.
            </p>
            <p>
              Mapping coverage: {ads.data?.mappingCoverage?.mapped ?? 0} of{" "}
              {ads.data?.mappingCoverage?.campaigns ?? 0} campaigns with spend history are mapped.
              WelcomeHome data reaches{" "}
              {wh.data?.latestProspectDate
                ? formatDateOnly(wh.data.latestProspectDate, "MMM d, yyyy")
                : "—"}
              . Lead-source labels resolved through the WelcomeHome lookup layer
              {labels.loading ? " (loading)" : ""}.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
