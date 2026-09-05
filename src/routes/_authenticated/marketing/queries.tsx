import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { GscExportNotice } from "@/components/clarity/gsc-export-notice";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CLASSIFICATIONS, CLASSIFICATION_LABELS, classificationLabel } from "@/lib/gsc/classification";
import { change } from "@/lib/gsc/compare";
import { downloadCsv, fmtDelta, fmtInt, fmtPercent, fmtPosition, toCsv } from "@/lib/gsc/format";
import { useSearchQueryReport } from "@/lib/gsc/api-queries";
import { GscManualSourceNote, GscSourceNote } from "@/components/clarity/gsc-source-note";
import { useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing/queries")({
  // Drill-through from Insights arrives with the query pre-filtered.
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"] : "",
    classification: typeof search["classification"] === "string" ? search["classification"] : "all",
  }),
  head: () => ({
    meta: [
      { title: "Query Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Search Console query performance with rule-based branded, local and care-type intent segmentation.",
      },
      { property: "og:title", content: "Query Intelligence — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "What people search before they find your communities, segmented by intent rules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QueryIntelligence,
});

type Row = {
  query: string;
  normalized_query: string;
  classification: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position_value: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
  prev_ctr: number | null;
  prev_position_value: number | null;
};

type SortKey = "clicks" | "impressions" | "ctr" | "position_value";

function QueryIntelligence() {
  const initial = Route.useSearch();
  const { organizationId, dateRange, comparisonRange, communityScope } = useAppState();
  const period = { start: dateRange.start, end: dateRange.end };
  // null = follow the global date filter; set = the user opened an older manual export.
  const [reportImportId, setReportImportId] = useState<string | null>(null);
  const report = useSearchQueryReport(organizationId, period, comparisonRange, reportImportId);
  const selection = report.selection;

  const [search, setSearch] = useState(initial.q);
  const [classification, setClassification] = useState<string>(initial.classification);
  const [sort, setSort] = useState<SortKey>("clicks");

  const all = (report.data ?? []) as Row[];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = all.filter((r) => {
      if (term && !r.normalized_query.includes(term)) return false;
      if (classification === "all") return true;
      if (classification === "unclassified") return !r.classification;
      return r.classification === classification;
    });
    return [...rows].sort((a, b) => {
      if (sort === "position_value") {
        const av = a.position_value ?? Number.POSITIVE_INFINITY;
        const bv = b.position_value ?? Number.POSITIVE_INFINITY;
        return av - bv;
      }
      return (b[sort] ?? 0) - (a[sort] ?? 0);
    });
  }, [all, search, classification, sort]);

  const totals = useMemo(() => {
    const clicks = filtered.reduce((s, r) => s + r.clicks, 0);
    const impressions = filtered.reduce((s, r) => s + r.impressions, 0);
    const weighted = filtered.reduce((s, r) => s + (r.position_value ?? 0) * r.impressions, 0);
    return {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : null,
      position: impressions ? weighted / impressions : null,
    };
  }, [filtered]);

  const segments = useMemo(() => {
    const map = new Map<string, { clicks: number; impressions: number }>();
    for (const r of all) {
      const key = r.classification ?? "unclassified";
      const e = map.get(key) ?? { clicks: 0, impressions: 0 };
      e.clicks += r.clicks;
      e.impressions += r.impressions;
      map.set(key, e);
    }
    return [...map.entries()].sort((a, b) => b[1].clicks - a[1].clicks);
  }, [all]);

  const hasRules = segments.some(([k]) => k !== "unclassified");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Query Intelligence"
        description="Search Console reports queries independently of pages, so these rows cannot be attributed to a specific community. Intent segments come only from the classification rules your administrators define."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered.length}
            onClick={() =>
              downloadCsv(
                `clarityiq-queries-${period.start}-${period.end}.csv`,
                toCsv(
                  [
                    "Query",
                    "Classification",
                    "Clicks",
                    "Impressions",
                    "CTR",
                    "Average position",
                    "Previous clicks",
                    "Previous impressions",
                    "Previous CTR",
                    "Previous average position",
                  ],
                  filtered.map((r) => [
                    r.query,
                    classificationLabel(r.classification),
                    r.clicks,
                    r.impressions,
                    r.ctr,
                    r.position_value,
                    r.prev_clicks,
                    r.prev_impressions,
                    r.prev_ctr,
                    r.prev_position_value,
                  ]),
                ),
              )
            }
          >
            <Download className="size-4" /> Export
          </Button>
        }
      />

      {communityScope.mode !== "all" ? (
        <p className="panel px-4 py-3 text-xs text-muted-foreground">
          The community filter does not apply to query data — Search Console does not provide a page
          dimension in the Queries report, so splitting it by community would be invented.
        </p>
      ) : null}

      {report.isLoading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : report.source === "none" && !selection.options.length ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="No query data for this period"
          description="No Search Console API rows cover this range and no Queries export has been imported for it."
        />
      ) : report.source === "none" ? (
        <GscExportNotice
          selection={selection}
          grainLabel="Queries"
          period={period}
          value={reportImportId}
          onChange={setReportImportId}
        />
      ) : (
        <>
          {report.source === "api" ? (
            <GscSourceNote
              source={report.source}
              coverage={report.coverage}
              period={period}
              comparison={comparisonRange}
              grainLabel="Queries"
            />
          ) : (
            <>
              <GscManualSourceNote grainLabel="Queries" />
              <GscExportNotice
                selection={selection}
                grainLabel="Queries"
                period={period}
                value={reportImportId}
                onChange={setReportImportId}
              />
            </>
          )}


          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Clicks (filtered)" value={fmtInt(totals.clicks)} />
            <MetricCard label="Impressions (filtered)" value={fmtInt(totals.impressions)} />
            <MetricCard label="CTR (filtered)" value={fmtPercent(totals.ctr)} />
            <MetricCard
              label="Average position"
              value={fmtPosition(totals.position)}
              footnote="impression weighted"
            />
          </div>

          <div className="panel space-y-3 p-5">
            <p className="eyebrow">Intent segmentation</p>
            {hasRules ? (
              <div className="flex flex-wrap gap-2">
                {segments.map(([key, v]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setClassification(key)}
                    className={cn(
                      "rounded-md border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-muted",
                      classification === key && "border-primary bg-muted",
                    )}
                  >
                    <span className="block font-medium text-foreground">
                      {classificationLabel(key === "unclassified" ? null : key)}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtInt(v.clicks)} clicks · {fmtInt(v.impressions)} impressions
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No classification rules have matched these queries yet. Branded, local and care-type
                segmentation stays empty until rules exist — nothing is inferred automatically.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter queries…"
              className="h-9 w-64"
            />
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger className="h-9 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classifications</SelectItem>
                <SelectItem value="unclassified">Unclassified</SelectItem>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLASSIFICATION_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clicks">Sort by clicks</SelectItem>
                <SelectItem value="impressions">Sort by impressions</SelectItem>
                <SelectItem value="ctr">Sort by CTR</SelectItem>
                <SelectItem value="position_value">Sort by position</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {fmtInt(filtered.length)} of {fmtInt(all.length)} queries
            </span>
          </div>

          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Query</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 500).map((r) => {
                  const d = change(r.clicks, r.prev_clicks);
                  const delta = r.prev_clicks === null ? null : fmtDelta(d.percent);
                  return (
                    <TableRow key={r.normalized_query}>
                      <TableCell className="max-w-sm truncate font-medium">{r.query}</TableCell>
                      <TableCell>
                        <Badge variant={r.classification ? "secondary" : "outline"}>
                          {classificationLabel(r.classification)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtInt(r.clicks)}
                        {delta ? (
                          <span
                            className={cn(
                              "ml-2 text-xs",
                              delta.tone === "up" && "text-success",
                              delta.tone === "down" && "text-destructive",
                              delta.tone === "neutral" && "text-muted-foreground",
                            )}
                          >
                            {delta.label}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{fmtInt(r.impressions)}</TableCell>
                      <TableCell className="text-right">{fmtPercent(r.ctr)}</TableCell>
                      <TableCell className="text-right">{fmtPosition(r.position_value)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > 500 ? (
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                Showing the first 500 rows. Export for the complete dataset.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
