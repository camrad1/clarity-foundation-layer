import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { GscExportNotice } from "@/components/clarity/gsc-export-notice";
import { PageHeader } from "@/components/clarity/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtInt, fmtPercent, fmtPosition } from "@/lib/gsc/format";
import { useSearchDimensionReport } from "@/lib/gsc/api-queries";
import { GscManualSourceNote, GscSourceNote } from "@/components/clarity/gsc-source-note";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/marketing/segments")({
  head: () => ({
    meta: [
      { title: "Search Segments — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Device, country and search appearance breakdowns from your Google Search Console exports.",
      },
      { property: "og:title", content: "Search Segments — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Independent Search Console report grains, kept separate and never combined.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Segments,
});

function SegmentTable({
  grain,
  table,
  label,
}: {
  grain: "device" | "country" | "search_appearance";
  table: "gsc_device_facts" | "gsc_country_facts" | "gsc_search_appearance_facts";
  label: string;
}) {
  const { organizationId, dateRange } = useAppState();
  const period = { start: dateRange.start, end: dateRange.end };
  // null = follow the global date filter; set = the user opened an older manual export.
  const [reportImportId, setReportImportId] = useState<string | null>(null);
  const report = useSearchDimensionReport(organizationId, period, grain, table, reportImportId);
  const selection = report.selection;
  const data = report.rows;

  const notice = (
    <GscExportNotice
      selection={selection}
      grainLabel={label}
      period={period}
      value={reportImportId}
      onChange={setReportImportId}
    />
  );

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{label}</h2>
      {report.source === "none" && !selection.options.length ? (
        <p className="panel px-4 py-6 text-sm text-muted-foreground">
          No {label} data is available for this period from the Search Console API or a manual
          import.
        </p>
      ) : report.source === "none" ? (
        notice
      ) : (
        <>
          {report.source === "api" ? (
            <GscSourceNote
              source={report.source}
              coverage={report.coverage}
              period={period}
              grainLabel={label}
            />
          ) : (
            <>
              <GscManualSourceNote grainLabel={label} />
              {notice}
            </>
          )}

          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{label}</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{fmtInt(r.clicks)}</TableCell>
                    <TableCell className="text-right">{fmtInt(r.impressions)}</TableCell>
                    <TableCell className="text-right">{fmtPercent(r.ctr)}</TableCell>
                    <TableCell className="text-right">{fmtPosition(r.position)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

function Segments() {
  const { organizationId } = useAppState();
  if (!organizationId)
    return (
      <EmptyState
        icon={<Layers className="size-6" />}
        title="Select an organization"
        description="Choose an organization to view its search segments."
      />
    );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Search Intelligence"
        title="Search Segments"
        description="Devices, countries and search appearance are separate Search Console reports. Each is shown on its own — they cannot be crossed with queries or pages, because Search Console does not report those combinations."
      />
      <SegmentTable grain="device" table="gsc_device_facts" label="Devices" />
      <SegmentTable grain="country" table="gsc_country_facts" label="Countries" />
      <SegmentTable
        grain="search_appearance"
        table="gsc_search_appearance_facts"
        label="Search appearance"
      />
    </div>
  );
}
