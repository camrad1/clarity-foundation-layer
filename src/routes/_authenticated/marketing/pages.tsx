import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, FileSearch } from "lucide-react";
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
import { useCommunities } from "@/lib/clarity-queries";
import { change } from "@/lib/gsc/compare";
import { downloadCsv, fmtDelta, fmtInt, fmtPercent, fmtPosition, toCsv } from "@/lib/gsc/format";
import { pageLabel } from "@/lib/gsc/normalize";
import { selectImportForPeriod, useGrainImports, usePageReport } from "@/lib/gsc/queries";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing/pages")({
  head: () => ({
    meta: [
      { title: "Page Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Search Console page performance resolved to canonical communities through your URL mapping rules.",
      },
      { property: "og:title", content: "Page Intelligence — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Which pages earn organic visibility, and which community they belong to.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PageIntelligence,
});

type Row = {
  page_url: string;
  normalized_url: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position_value: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
  prev_ctr: number | null;
  prev_position_value: number | null;
  mapped_community_id: string | null;
  community_name: string | null;
  mapped_content_type: string | null;
  mapped_intent_type: string | null;
  mapped_topic: string | null;
  mapping_rule_id: string | null;
};

function PageIntelligence() {
  const { organizationId, dateRange, communityScope } = useAppState();
  const communities = useCommunities(organizationId);
  const grains = useGrainImports(organizationId, "page");
  const period = { start: dateRange.start, end: dateRange.end };
  // null = follow the global date filter; set = the user opened an older export.
  const [reportImportId, setReportImportId] = useState<string | null>(null);
  const selection = useMemo(
    () => selectImportForPeriod(grains.data ?? [], period, reportImportId),
    [grains.data, period.start, period.end, reportImportId],
  );

  const report = usePageReport(
    organizationId,
    selection.current?.import_id ?? null,
    selection.comparison?.import_id ?? null,
  );

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"pages" | "communities">("pages");
  const [mapping, setMapping] = useState<"all" | "mapped" | "unmapped">("all");

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

  const all = (report.data ?? []) as Row[];

  const scoped = useMemo(() => {
    if (communityScope.mode === "all") return all;
    // Unmapped pages cannot be claimed by a community, so a community filter
    // deliberately excludes them rather than guessing.
    return all.filter((r) => r.mapped_community_id && scopedIds.has(r.mapped_community_id));
  }, [all, communityScope.mode, scopedIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped
      .filter((r) => {
        if (term && !r.normalized_url.includes(term)) return false;
        if (mapping === "mapped") return !!r.mapped_community_id;
        if (mapping === "unmapped") return !r.mapped_community_id;
        return true;
      })
      .sort((a, b) => b.clicks - a.clicks);
  }, [scoped, search, mapping]);

  const byCommunity = useMemo(() => {
    const map = new Map<
      string,
      { name: string; clicks: number; impressions: number; weighted: number; pages: number }
    >();
    for (const r of scoped) {
      const key = r.mapped_community_id ?? "unmapped";
      const e =
        map.get(key) ??
        { name: r.community_name ?? "Unmapped pages", clicks: 0, impressions: 0, weighted: 0, pages: 0 };
      e.clicks += r.clicks;
      e.impressions += r.impressions;
      e.weighted += (r.position_value ?? 0) * r.impressions;
      e.pages += 1;
      map.set(key, e);
    }
    return [...map.entries()]
      .map(([id, v]) => ({
        id,
        name: v.name,
        clicks: v.clicks,
        impressions: v.impressions,
        pages: v.pages,
        ctr: v.impressions ? v.clicks / v.impressions : null,
        position: v.impressions ? v.weighted / v.impressions : null,
      }))
      .sort((a, b) => b.clicks - a.clicks);
  }, [scoped]);

  const unmapped = all.filter((r) => !r.mapped_community_id);
  const unmappedClicks = unmapped.reduce((s, r) => s + r.clicks, 0);
  const totalClicks = all.reduce((s, r) => s + r.clicks, 0);
  const mappedCoverage = totalClicks ? 1 - unmappedClicks / totalClicks : null;
  const mappedPages = all.length - unmapped.length;
  const scopedCommunityNames = (communities.data ?? [])
    .filter((c) => scopedIds.has(c.id))
    .map((c) => c.name);
  const scopeLabel =
    scopedCommunityNames.length === 1
      ? scopedCommunityNames[0]
      : `the ${scopedCommunityNames.length} selected communities`;


  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Page Intelligence"
        description="Page rows are matched to communities using your URL mapping rules only. Pages that no rule matches remain unmapped and are never assigned to a community by inference."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered.length}
            onClick={() =>
              downloadCsv(
                `clarityiq-pages-${selection.current?.period_start}-${selection.current?.period_end}.csv`,
                toCsv(
                  [
                    "Page",
                    "Community",
                    "Content type",
                    "Intent",
                    "Topic",
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
                    r.page_url,
                    r.community_name ?? "Unmapped",
                    r.mapped_content_type,
                    r.mapped_intent_type,
                    r.mapped_topic,
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

      {grains.isLoading || report.isLoading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !selection.options.length ? (
        <EmptyState
          icon={<FileSearch className="size-6" />}
          title="No Pages report imported"
          description="Upload a Search Console export containing the Pages report from Admin → Search Console Imports."
        />
      ) : !selection.current ? (
        <GscExportNotice
          selection={selection}
          grainLabel="Pages"
          period={period}
          value={reportImportId}
          onChange={setReportImportId}
        />
      ) : (
        <>
          <GscExportNotice
            selection={selection}
            grainLabel="Pages"
            period={period}
            value={reportImportId}
            onChange={setReportImportId}
          />


          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Mapped pages"
              value={`${fmtInt(mappedPages)} / ${fmtInt(all.length)}`}
              footnote={`${fmtInt(unmapped.length)} page(s) match no URL rule`}
            />
            <MetricCard
              label="Mapped click coverage"
              value={fmtPercent(mappedCoverage, 1)}
              footnote={`${fmtInt(totalClicks - unmappedClicks)} of ${fmtInt(totalClicks)} clicks`}
            />

            <MetricCard label="Clicks in scope" value={fmtInt(scoped.reduce((s, r) => s + r.clicks, 0))} />
            <MetricCard
              label="Impressions in scope"
              value={fmtInt(scoped.reduce((s, r) => s + r.impressions, 0))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pages">Page detail</SelectItem>
                <SelectItem value="communities">By community</SelectItem>
              </SelectContent>
            </Select>
            {view === "pages" ? (
              <>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter URLs…"
                  className="h-9 w-64"
                />
                <Select value={mapping} onValueChange={(v) => setMapping(v as typeof mapping)}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All pages</SelectItem>
                    <SelectItem value="mapped">Mapped only</SelectItem>
                    <SelectItem value="unmapped">Unmapped only</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>

          {view === "communities" ? (
            <div className="panel overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Community</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byCommunity.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.name}
                        {c.id === "unmapped" ? (
                          <Badge variant="outline" className="ml-2">
                            No rule match
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{fmtInt(c.pages)}</TableCell>
                      <TableCell className="text-right">{fmtInt(c.clicks)}</TableCell>
                      <TableCell className="text-right">{fmtInt(c.impressions)}</TableCell>
                      <TableCell className="text-right">{fmtPercent(c.ctr)}</TableCell>
                      <TableCell className="text-right">{fmtPosition(c.position)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Page</TableHead>
                    <TableHead>Community</TableHead>
                    <TableHead>Content</TableHead>
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
                      <TableRow key={r.normalized_url}>
                        <TableCell className="max-w-xs truncate" title={r.page_url}>
                          {pageLabel(r.page_url)}
                        </TableCell>
                        <TableCell>
                          {r.community_name ? (
                            <Badge variant="secondary">{r.community_name}</Badge>
                          ) : (
                            <Badge variant="outline">Unmapped</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.mapped_content_type ?? "—"}
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
          )}
        </>
      )}
    </div>
  );
}
