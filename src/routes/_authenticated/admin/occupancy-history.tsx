import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/clarity/empty-state";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgRole } from "@/lib/clarity-queries";
import {
  occHistoryDeleteBatch,
  occHistoryImport,
  occHistoryPreview,
} from "@/lib/occupancy-history/import.functions";
import {
  OCC_HISTORY_CUTOFF,
  useOccHistoryBatches,
  useOccHistoryHealth,
} from "@/lib/occupancy-history/queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/occupancy-history")({
  head: () => ({
    meta: [
      { title: "Occupancy History Import — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Import the official day-over-day occupancy workbooks that provide ClarityIQ's historical occupancy before nightly snapshots began.",
      },
      { property: "og:title", content: "Occupancy History Import — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Audited, idempotent backfill of official daily occupancy history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OccupancyHistoryImport,
});

type Preview = Awaited<ReturnType<typeof occHistoryPreview>>;
const IGNORE = "__ignore__";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) {
    bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function OccupancyHistoryImport() {
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const batches = useOccHistoryBatches(organizationId);
  const health = useOccHistoryHealth(organizationId, []);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    if (!organizationId) return;
    setBusy(true);
    setPreview(null);
    try {
      const result = await occHistoryPreview({
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
      const result = await occHistoryImport({
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
        `Imported ${result.imported} daily records across ${preview.communities.length} workbook communities.`,
      );
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["occ_history_batches", organizationId] }),
        qc.invalidateQueries({ queryKey: ["occ_history_health", organizationId] }),
        qc.invalidateQueries({ queryKey: ["wh_occupancy_trend"] }),
        qc.invalidateQueries({ queryKey: ["wh_occupancy_monthly_history"] }),
        qc.invalidateQueries({ queryKey: ["flash_report"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(batchId: string) {
    if (!organizationId) return;
    setBusy(true);
    try {
      await occHistoryDeleteBatch({ data: { organizationId, batchId } });
      toast.success("Import batch removed.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["occ_history_batches", organizationId] }),
        qc.invalidateQueries({ queryKey: ["occ_history_health", organizationId] }),
        qc.invalidateQueries({ queryKey: ["wh_occupancy_trend"] }),
        qc.invalidateQueries({ queryKey: ["wh_occupancy_monthly_history"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove that batch");
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
        title="Occupancy History Import"
        description="Official day-over-day occupancy workbooks provide historical occupancy for dates before nightly snapshots began. Nightly snapshots always take precedence, current occupancy is never overwritten, and no missing day is ever interpolated."
      />

      <section className="panel space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Upload a workbook</h2>
          <Badge variant="outline" className="gap-1">
            <CalendarClock className="size-3" /> Cutoff {OCC_HISTORY_CUTOFF} — later dates are skipped
          </Badge>
        </div>
        {!canManageImports ? (
          <p className="text-sm text-muted-foreground">
            You do not have permission to import occupancy history for this organization.
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
              Re-importing the same workbook is safe: records are matched on community and date and updated in
              place rather than duplicated.
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
                Sheet “{preview.sheetName}” · {preview.rangeStart ?? "—"} to {preview.rangeEnd ?? "—"} ·{" "}
                {preview.rollupRowsSkipped} rollup row(s) excluded · {preview.futureRowsSkipped} value(s) after
                the cutoff skipped
              </p>
            </div>
            <Button onClick={() => void onImport()} disabled={busy || mappedCount === 0}>
              <Upload className="mr-2 size-4" />
              Import {mappedCount} community/ies
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

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workbook community</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Range</TableHead>
                <TableHead className="text-right">Flagged</TableHead>
                <TableHead>Maps to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.communities.map((c) => (
                <TableRow key={c.normalizedName}>
                  <TableCell className="font-medium">{c.sourceName}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.days}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.firstDate ?? "—"} → {c.lastDate ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.warningDays || "—"}</TableCell>
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
        <h2 className="text-sm font-semibold">Imported history coverage</h2>
        {(health.data ?? []).length === 0 ? (
          <EmptyState
            title="No official history imported yet"
            description="Upload the official day-over-day occupancy workbooks to give ClarityIQ historical occupancy for dates before nightly snapshots began."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Community</TableHead>
                  <TableHead>First day</TableHead>
                  <TableHead>Last day</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Missing days</TableHead>
                  <TableHead className="text-right">Flagged</TableHead>
                  <TableHead>Last import</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(health.data ?? []).map((r) => (
                  <TableRow key={r.community_id}>
                    <TableCell className="font-medium">{r.community_name}</TableCell>
                    <TableCell>{r.first_date ?? "—"}</TableCell>
                    <TableCell>{r.last_date ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.record_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.missing_days || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.warning_count || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_import_at ? format(new Date(r.last_import_at), "MMM d, yyyy h:mm a") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Import audit trail</h2>
        {(batches.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports recorded yet.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Source range</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">After cutoff</TableHead>
                  <TableHead className="text-right">Flagged</TableHead>
                  <TableHead>Unmapped</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batches.data ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.source_file_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.source_range_start ?? "—"} → {b.source_range_end ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.records_imported}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rows_skipped}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.future_rows_skipped}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.validation_warnings || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.unmapped_communities?.length ? b.unmapped_communities.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(b.imported_at), "MMM d, yyyy h:mm a")}
                    </TableCell>
                    <TableCell>
                      {canManageImports && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void onDelete(b.id)}
                          aria-label="Remove this import batch"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
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
