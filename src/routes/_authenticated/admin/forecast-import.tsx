import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/clarity/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgRole } from "@/lib/clarity-queries";
import { forecastImportPreview, forecastImportRun } from "@/lib/forecast/import.functions";
import { useForecastImportBatches } from "@/lib/forecast/queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/forecast-import")({
  head: () => ({
    meta: [
      { title: "Forecast Import — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Import historical weekly move-in and move-out forecast workbooks into the ClarityIQ Forecast Tracker.",
      },
      { property: "og:title", content: "Forecast Import — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Audited, idempotent import of historical weekly forecast snapshots.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForecastImport,
});

type Preview = Awaited<ReturnType<typeof forecastImportPreview>>;
const IGNORE = "__ignore__";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(bin);
}

function ForecastImport() {
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const batches = useForecastImportBatches(organizationId);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    if (!organizationId) return;
    setBusy(true);
    setPreview(null);
    try {
      const result = await forecastImportPreview({
        data: { organizationId, fileName: f.name, fileBase64: await fileToBase64(f) },
      });
      setFile(f);
      setPreview(result);
      setChoices(
        Object.fromEntries(
          result.communities.map((c) => [
            c.normalizedName,
            c.ignored ? IGNORE : (c.suggestedCommunityId ?? ""),
          ]),
        ),
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read that workbook");
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!organizationId || !file || !preview) return;
    setBusy(true);
    try {
      const result = await forecastImportRun({
        data: {
          organizationId,
          fileName: file.name,
          fileBase64: await fileToBase64(file),
          rememberMappings: true,
          mappings: preview.communities.map((c) => {
            const choice = choices[c.normalizedName] ?? "";
            return {
              normalizedName: c.normalizedName,
              sourceName: c.sourceName,
              communityId: choice && choice !== IGNORE ? choice : null,
              ignored: choice === IGNORE,
            };
          }),
        },
      });
      toast.success(
        `Imported ${result.imported} weekly forecast records (${result.notes} notes, ${result.stretch} stretch/goal values)` +
          (result.alreadyPresent ? ` · ${result.alreadyPresent} already imported, left unchanged` : "") +
          (result.protectedManual ? ` · ${result.protectedManual} manual entries left untouched` : ""),
      );
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["forecast_import_batches", organizationId] }),
        qc.invalidateQueries({ queryKey: ["forecast_entries"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const mappedCount = preview
    ? preview.communities.filter((c) => {
        const v = choices[c.normalizedName];
        return v && v !== IGNORE;
      }).length
    : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Forecast Import"
        description="Import historical weekly forecast workbooks into the Forecast Tracker. Only clean in/out values become numbers — ambiguous free text is preserved as a historical note and never converted into a projection."
      />

      <section className="panel space-y-4 p-6">
        <h2 className="text-sm font-semibold">Upload a workbook</h2>
        {!canManageImports ? (
          <p className="text-sm text-muted-foreground">
            You do not have permission to import forecasts for this organization.
          </p>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-foreground"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Re-importing the same workbook is safe: records are matched on community and forecast date and
              updated in place rather than duplicated.
            </p>
          </>
        )}
      </section>

      {preview && (
        <section className="panel space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{preview.fileName}</h2>
              <p className="text-xs text-muted-foreground">
                Sheet “{preview.sheetName}” · {preview.communities.length} communities ·{" "}
                {preview.months.length} forecast months · {preview.forecastDates.length} weekly forecast dates ·{" "}
                {preview.numericRecords} numeric forecasts · {preview.stretchRecords} stretch/goal values ·{" "}
                {preview.noteRecords} notes · {preview.ambiguousRecords} ambiguous cells ·{" "}
                {preview.eomMonths.length} month-end reference column(s)
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {preview.months.map((m) => `${m.label} (${m.dates.length})`).join(" · ")}
              </p>
            </div>
            <Button onClick={() => void onImport()} disabled={busy || mappedCount === 0}>
              <Upload className="mr-2 size-4" /> Import {mappedCount} community/ies
            </Button>
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              {preview.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {preview.ambiguousSamples.length > 0 && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Ambiguous cells kept as notes (no numbers inferred)</p>
              {preview.ambiguousSamples.slice(0, 8).map((a) => (
                <p key={`${a.community}-${a.date}-${a.text}`}>
                  {a.community} · {a.date} · “{a.text}”
                </p>
              ))}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workbook community</TableHead>
                <TableHead className="text-right">Forecasts</TableHead>
                <TableHead className="text-right">Stretch</TableHead>
                <TableHead className="text-right">Notes</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Maps to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.communities.map((c) => (
                <TableRow key={c.normalizedName}>
                  <TableCell className="font-medium">{c.sourceName}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.numericCells}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.stretchCells || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.noteCells || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.firstDate ?? "—"} → {c.lastDate ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.matchSource === "unmapped" ? (
                      <span className="text-warning">needs mapping</span>
                    ) : (
                      c.matchSource
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={choices[c.normalizedName] || IGNORE}
                      onValueChange={(v) => setChoices((s) => ({ ...s, [c.normalizedName]: v }))}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Do not import" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>Do not import</SelectItem>
                        {preview.availableCommunities.map((ac: { id: string; name: string }) => (
                          <SelectItem key={ac.id} value={ac.id}>
                            {ac.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Import audit trail</h2>
        {(batches.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No forecast imports recorded yet.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="text-right">Communities</TableHead>
                  <TableHead className="text-right">Dates</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Notes</TableHead>
                  <TableHead className="text-right">Ambiguous</TableHead>
                  <TableHead>Unmapped</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batches.data ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.source_file_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.communities_detected}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.forecast_dates_detected}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.records_imported}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.notes_imported || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.ambiguous_cells || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.unmapped_communities?.length ? b.unmapped_communities.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(b.imported_at), "MMM d, yyyy h:mm a")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
