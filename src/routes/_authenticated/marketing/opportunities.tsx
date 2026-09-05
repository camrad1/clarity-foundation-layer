import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Target } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { GscExportNotice } from "@/components/clarity/gsc-export-notice";
import { MetricCard } from "@/components/clarity/metric-card";
import { PageHeader } from "@/components/clarity/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { classificationLabel } from "@/lib/gsc/classification";
import { downloadCsv, fmtInt, fmtPercent, fmtPosition, toCsv } from "@/lib/gsc/format";
import { pageLabel } from "@/lib/gsc/normalize";
import {
  DEFAULT_THRESHOLDS,
  OPPORTUNITY_LABELS,
  OPPORTUNITY_METHODOLOGY,
  ctrBenchmarks,
  opportunityFlags,
  type MetricLike,
  type OpportunityFlag,
} from "@/lib/gsc/opportunities";
import { useSearchPageReport, useSearchQueryReport } from "@/lib/gsc/api-queries";
import { GscManualSourceNote, GscSourceNote } from "@/components/clarity/gsc-source-note";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/marketing/opportunities")({
  head: () => ({
    meta: [
      { title: "Search Opportunities — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Deterministic striking-distance, page-one and low click-through opportunities from Search Console data.",
      },
      { property: "og:title", content: "Search Opportunities — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Rule-based opportunities with the methodology stated on every table.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Opportunities,
});

type Base = MetricLike & { label: string; secondary: string | null; key: string };

function Opportunities() {
  const { organizationId, dateRange } = useAppState();
  const [dataset, setDataset] = useState<"query" | "page">("query");
  const [flag, setFlag] = useState<OpportunityFlag>("striking");

  const period = { start: dateRange.start, end: dateRange.end };

  // null = follow the global date filter; set = the user opened an older manual export.
  const [reportImportId, setReportImportId] = useState<string | null>(null);
  const queryReport = useSearchQueryReport(organizationId, period, null, reportImportId);
  const pageReport = useSearchPageReport(organizationId, period, null, reportImportId);
  const active = dataset === "query" ? queryReport : pageReport;
  const selection = active.selection;

  const rows: Base[] = useMemo(() => {
    if (dataset === "query") {
      return ((queryReport.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        key: String(r["normalized_query"]),
        label: String(r["query"]),
        secondary: classificationLabel(r["classification"] as string | null | undefined),
        clicks: Number(r["clicks"] ?? 0),
        impressions: Number(r["impressions"] ?? 0),
        ctr: r["ctr"] == null ? null : Number(r["ctr"]),
        position: r["position_value"] == null ? null : Number(r["position_value"]),
      }));
    }
    return ((pageReport.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      key: String(r["normalized_url"]),
      label: pageLabel(String(r["page_url"])),
      secondary: (r["community_name"] as string | null | undefined) ?? "Unmapped",
      clicks: Number(r["clicks"] ?? 0),
      impressions: Number(r["impressions"] ?? 0),
      ctr: r["ctr"] == null ? null : Number(r["ctr"]),
      position: r["position_value"] == null ? null : Number(r["position_value"]),
    }));
  }, [dataset, queryReport.data, pageReport.data]);

  const benchmarks = useMemo(() => ctrBenchmarks(rows), [rows]);
  const flagged = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, flags: opportunityFlags(r, benchmarks) }))
        .filter((x) => x.flags.length),
    [rows, benchmarks],
  );

  const counts = useMemo(() => {
    const c: Record<OpportunityFlag, number> = { striking: 0, page1: 0, low_ctr: 0 };
    for (const f of flagged) for (const k of f.flags) c[k] += 1;
    return c;
  }, [flagged]);

  const visible = flagged
    .filter((x) => x.flags.includes(flag))
    .sort((a, b) => b.row.impressions - a.row.impressions);

  const loading = active.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Opportunities"
        description="Every opportunity here is produced by a fixed, published rule applied to imported Search Console data. There is no model, no scoring black box and no projected revenue."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!visible.length}
            onClick={() =>
              downloadCsv(
                `clarityiq-opportunities-${flag}-${dataset}.csv`,
                toCsv(
                  [
                    "Item",
                    "Context",
                    "Opportunity",
                    "Clicks",
                    "Impressions",
                    "CTR",
                    "Average position",
                  ],
                  visible.map((x) => [
                    x.row.label,
                    x.row.secondary,
                    x.flags.map((f) => OPPORTUNITY_LABELS[f]).join(" / "),
                    x.row.clicks,
                    x.row.impressions,
                    x.row.ctr,
                    x.row.position,
                  ]),
                ),
              )
            }
          >
            <Download className="size-4" /> Export
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={dataset} onValueChange={(v) => setDataset(v as typeof dataset)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="query">Queries</SelectItem>
            <SelectItem value="page">Pages</SelectItem>
          </SelectContent>
        </Select>
        <Select value={flag} onValueChange={(v) => setFlag(v as OpportunityFlag)}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="striking">{OPPORTUNITY_LABELS.striking}</SelectItem>
            <SelectItem value="page1">{OPPORTUNITY_LABELS.page1}</SelectItem>
            <SelectItem value="low_ctr">{OPPORTUNITY_LABELS.low_ctr}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Minimum {fmtInt(DEFAULT_THRESHOLDS.minImpressions)} impressions
        </span>
      </div>

      {loading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : active.source === "none" && !selection.options.length ? (
        <EmptyState
          icon={<Target className="size-6" />}
          title="No data for this grain and period"
          description="No Search Console API rows cover this range and no matching export has been imported."
        />
      ) : active.source === "none" ? (
        <GscExportNotice
          selection={selection}
          grainLabel={dataset === "query" ? "Queries" : "Pages"}
          period={period}
          value={reportImportId}
          onChange={setReportImportId}
        />
      ) : (
        <>
          {active.source === "api" ? (
            <GscSourceNote
              source={active.source}
              coverage={active.coverage}
              period={period}
              grainLabel={dataset === "query" ? "Queries" : "Pages"}
            />
          ) : (
            <>
              <GscManualSourceNote grainLabel={dataset === "query" ? "Queries" : "Pages"} />
              <GscExportNotice
                selection={selection}
                grainLabel={dataset === "query" ? "Queries" : "Pages"}
                period={period}
                value={reportImportId}
                onChange={setReportImportId}
              />
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard label={OPPORTUNITY_LABELS.striking} value={fmtInt(counts.striking)} />
            <MetricCard label={OPPORTUNITY_LABELS.page1} value={fmtInt(counts.page1)} />
            <MetricCard label={OPPORTUNITY_LABELS.low_ctr} value={fmtInt(counts.low_ctr)} />
          </div>

          <p className="panel px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Methodology.</span>{" "}
            {flag === "striking"
              ? OPPORTUNITY_METHODOLOGY.striking
              : flag === "page1"
                ? OPPORTUNITY_METHODOLOGY.page1
                : OPPORTUNITY_METHODOLOGY.lowCtr}{" "}
            These are review priorities, not guaranteed outcomes.
          </p>

          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{dataset === "query" ? "Query" : "Page"}</TableHead>
                  <TableHead>{dataset === "query" ? "Classification" : "Community"}</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.slice(0, 300).map((x) => (
                  <TableRow key={x.row.key}>
                    <TableCell className="max-w-xs truncate font-medium">{x.row.label}</TableCell>
                    <TableCell className="text-muted-foreground">{x.row.secondary}</TableCell>
                    <TableCell className="space-x-1">
                      {x.flags.map((f) => (
                        <Badge key={f} variant="secondary">
                          {OPPORTUNITY_LABELS[f]}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">{fmtInt(x.row.clicks)}</TableCell>
                    <TableCell className="text-right">{fmtInt(x.row.impressions)}</TableCell>
                    <TableCell className="text-right">{fmtPercent(x.row.ctr)}</TableCell>
                    <TableCell className="text-right">{fmtPosition(x.row.position)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!visible.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No rows meet this rule in the imported data.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
