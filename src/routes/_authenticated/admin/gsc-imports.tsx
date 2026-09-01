import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useConnections, useOrgRole } from "@/lib/clarity-queries";
import { fmtInt } from "@/lib/gsc/format";
import { runGscImport, reapplyPageMappings } from "@/lib/gsc/import";
import { GRAIN_LABELS, grainTotals, parseGscFile, type ParsedFile } from "@/lib/gsc/parse";
import { useGscImports } from "@/lib/gsc/queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/gsc-imports")({
  head: () => ({
    meta: [
      { title: "Search Console Imports — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Upload, review and audit Google Search Console exports powering ClarityIQ Search Intelligence.",
      },
      { property: "og:title", content: "Search Console Imports — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Duplicate-safe Search Console file imports with a complete audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GscImports,
});

type ImportRow = {
  id: string;
  file_name: string;
  imported_at: string;
  import_status: string;
  data_start_date: string | null;
  data_end_date: string | null;
  error_summary: string | null;
  warnings: string[] | null;
  data_source_connections: { display_name: string } | null;
  gsc_import_grains: {
    grain: string;
    row_count: number;
    is_active: boolean;
    period_start: string | null;
    period_end: string | null;
  }[];
};

function GscImports() {
  const { organizationId } = useAppState();
  const { isOrgAdmin } = useOrgRole(organizationId);
  const connections = useConnections(organizationId);
  const imports = useGscImports(organizationId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [connectionId, setConnectionId] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const gscConnections = (connections.data ?? []).filter((c) => c.source_type === "search_console");
  const rows = (imports.data ?? []) as unknown as ImportRow[];

  const needsManualPeriod = !!parsed && !parsed.dataStartDate;
  const effectivePeriod = {
    start: parsed?.dataStartDate ?? periodStart,
    end: parsed?.dataEndDate ?? periodEnd,
  };

  async function onFile(file: File) {
    setBusy(true);
    try {
      const result = await parseGscFile(file);
      setParsed(result);
      if (result.dataStartDate) {
        setPeriodStart(result.dataStartDate);
        setPeriodEnd(result.dataEndDate ?? result.dataStartDate);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!organizationId || !connectionId || !parsed) return;
    if (!effectivePeriod.start || !effectivePeriod.end) {
      toast.error("Enter the period this export covers.");
      return;
    }
    setBusy(true);
    try {
      const outcome = await runGscImport({
        organizationId,
        connectionId,
        parsed,
        period: { start: effectivePeriod.start, end: effectivePeriod.end },
      });
      if (outcome.status === "duplicate") {
        toast.warning(`Already imported as "${outcome.fileName}". Nothing was written.`);
      } else if (outcome.status === "failed") {
        toast.error(outcome.message);
      } else {
        toast.success(
          `Imported ${Object.entries(outcome.rowCounts)
            .map(([g, n]) => `${fmtInt(n)} ${GRAIN_LABELS[g as keyof typeof GRAIN_LABELS]}`)
            .join(", ")} rows.`,
        );
        setParsed(null);
        if (fileRef.current) fileRef.current.value = "";
        await qc.invalidateQueries();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isOrgAdmin)
    return (
      <EmptyState
        title="Administrator access required"
        description="Search Console imports are managed by organization administrators."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Search Console Imports"
        description="Upload standard Search Console exports (ZIP, XLSX or CSV). Each report inside the file is stored as its own grain; a re-uploaded identical file is rejected, and an overlapping period supersedes the older export so totals are never double counted."
      />

      {!gscConnections.length ? (
        <EmptyState
          title="No Search Console data source"
          description="Create a Google Search Console connection in Admin → Data Sources before importing files."
        />
      ) : (
        <div className="panel space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data source connection</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select a connection" />
                </SelectTrigger>
                <SelectContent>
                  {gscConnections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Export file</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".zip,.csv,.tsv,.xlsx,.xls"
                className="h-9"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </div>
          </div>

          {parsed ? (
            <div className="space-y-4 rounded-md border border-border p-4">
              <p className="text-sm font-medium text-foreground">{parsed.fileName}</p>

              {parsed.errors.length ? (
                <ul className="space-y-1 text-sm text-destructive">
                  {parsed.errors.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Report</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.grains.map((g) => {
                      const t = grainTotals(g.rows);
                      return (
                        <TableRow key={g.grain}>
                          <TableCell className="font-medium">{GRAIN_LABELS[g.grain]}</TableCell>
                          <TableCell className="text-right">{fmtInt(g.rows.length)}</TableCell>
                          <TableCell className="text-right">{fmtInt(t.clicks)}</TableCell>
                          <TableCell className="text-right">{fmtInt(t.impressions)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {parsed.warnings.length ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              ) : null}

              {needsManualPeriod ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Period start</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Period end</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    This export has no Dates report, so ClarityIQ cannot infer the period it covers.
                    Enter the exact range you selected in Search Console.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Period detected from the Dates report:{" "}
                  {parsed.dataStartDate
                    ? `${format(parseISO(parsed.dataStartDate), "MMM d, yyyy")} – ${format(parseISO(parsed.dataEndDate!), "MMM d, yyyy")}`
                    : "—"}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void onImport()}
                  disabled={busy || !connectionId || !!parsed.errors.length}
                >
                  <Upload className="size-4" /> Import
                </Button>
                <Button variant="ghost" onClick={() => setParsed(null)} disabled={busy}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Import history</h2>
        {imports.isLoading ? (
          <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !rows.length ? (
          <EmptyState title="No imports yet" description="Imported files and their grains appear here." />
        ) : (
          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>File</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[220px] truncate font-medium" title={r.file_name}>
                      {r.file_name}
                      {r.error_summary ? (
                        <span className="block text-xs text-destructive">{r.error_summary}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.data_source_connections?.display_name ?? "—"}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {(r.gsc_import_grains ?? []).map((g) => (
                        <Badge key={g.grain} variant={g.is_active ? "secondary" : "outline"}>
                          {GRAIN_LABELS[g.grain as keyof typeof GRAIN_LABELS]} · {fmtInt(g.row_count)}
                          {g.is_active ? "" : " (superseded)"}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.data_start_date && r.data_end_date
                        ? `${format(parseISO(r.data_start_date), "MMM d")} – ${format(parseISO(r.data_end_date), "MMM d, yyyy")}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(r.imported_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={r.import_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.gsc_import_grains?.some((g) => g.grain === "page") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              const n = await reapplyPageMappings(r.id);
                              toast.success(`Re-applied URL rules to ${fmtInt(Number(n))} page(s).`);
                              await qc.invalidateQueries();
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          <RefreshCw className="size-3.5" /> Re-map
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
        Files are parsed in your browser and only the aggregated report rows are stored. No file
        contents, credentials or personal data are retained.
      </p>
    </div>
  );
}
