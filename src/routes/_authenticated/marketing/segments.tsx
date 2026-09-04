import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { selectImportForPeriod, useGrainImports, useSimpleGrain } from "@/lib/gsc/queries";
import type { GrainKey } from "@/lib/gsc/parse";
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

type Metrics = { clicks: number; impressions: number; ctr: number | null; position: number | null };

function SegmentTable({
  grain,
  table,
  dimension,
  label,
}: {
  grain: GrainKey;
  table: "gsc_device_facts" | "gsc_country_facts" | "gsc_search_appearance_facts";
  dimension: "device" | "country" | "search_appearance";
  label: string;
}) {
  const { organizationId, dateRange } = useAppState();
  const grains = useGrainImports(organizationId, grain);
  const period = { start: dateRange.start, end: dateRange.end };
  // null = follow the global date filter; set = the user opened an older export.
  const [reportImportId, setReportImportId] = useState<string | null>(null);
  const selection = useMemo(
    () => selectImportForPeriod(grains.data ?? [], period, reportImportId),
    [grains.data, period.start, period.end, reportImportId],
  );
  const rows = useSimpleGrain(table, dimension, selection.current?.import_id ?? null);
  const data = (rows.data ?? []) as (Metrics & Record<string, unknown>)[];

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
      {!selection.options.length ? (
        <p className="panel px-4 py-6 text-sm text-muted-foreground">
          No {label} report has been imported. This grain stays empty until an export containing it
          is uploaded.
        </p>
      ) : !selection.current ? (
        notice
      ) : (
        <>
          {notice}

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
                    <TableCell className="font-medium">{String(r[dimension] ?? "—")}</TableCell>
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
        description="Devices, countries and search appearance are separate Search Console reports. Each is shown on its own — they cannot be crossed with queries or pages because the export does not contain those combinations."
      />
      <SegmentTable grain="device" table="gsc_device_facts" dimension="device" label="Devices" />
      <SegmentTable grain="country" table="gsc_country_facts" dimension="country" label="Countries" />
      <SegmentTable
        grain="search_appearance"
        table="gsc_search_appearance_facts"
        dimension="search_appearance"
        label="Search appearance"
      />
    </div>
  );
}
