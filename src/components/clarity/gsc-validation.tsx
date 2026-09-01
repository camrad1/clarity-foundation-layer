import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtInt, fmtPercent, fmtPosition } from "@/lib/gsc/format";
import { useGrainImports } from "@/lib/gsc/queries";

/**
 * Search Console validation.
 *
 * The ClarityIQ value is produced by exactly the same deterministic function
 * Search Overview uses (`gsc_daily_totals`, active Dates grains only). The
 * source value is read back from the rows of the selected export itself
 * (`gsc_import_daily_totals`), so an administrator is never asked to retype
 * numbers ClarityIQ already holds. Nothing is inferred, and a matching check
 * never promotes the metric definition to validated on its own.
 */

const GSC_METRICS = [
  { key: "gsc.clicks", label: "Search Clicks" },
  { key: "gsc.impressions", label: "Search Impressions" },
  { key: "gsc.ctr", label: "Search CTR" },
  { key: "gsc.avg_position", label: "Average Position" },
] as const;

type MetricKey = (typeof GSC_METRICS)[number]["key"];

type Totals = {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  avg_position: number | null;
} | null;

function pick(totals: Totals, metric: MetricKey): number | null {
  if (!totals) return null;
  switch (metric) {
    case "gsc.clicks":
      return totals.clicks === null ? null : Number(totals.clicks);
    case "gsc.impressions":
      return totals.impressions === null ? null : Number(totals.impressions);
    case "gsc.ctr":
      return totals.ctr === null ? null : Number(totals.ctr);
    case "gsc.avg_position":
      return totals.avg_position === null ? null : Number(totals.avg_position);
  }
}

function display(metric: MetricKey, value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (metric === "gsc.ctr") return fmtPercent(value);
  if (metric === "gsc.avg_position") return fmtPosition(value);
  return fmtInt(value);
}

/** Tolerance reflects the precision of the exported numbers, not a fudge factor. */
function tolerance(metric: MetricKey) {
  if (metric === "gsc.ctr") return 0.00005;
  if (metric === "gsc.avg_position") return 0.005;
  return 0;
}

export function GscValidation({ organizationId }: { organizationId: string | null }) {
  const qc = useQueryClient();
  const grains = useGrainImports(organizationId, "daily");
  const [importId, setImportId] = useState("");
  const [metric, setMetric] = useState<MetricKey>("gsc.clicks");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    calculated: number | null;
    source: number | null;
    difference: number | null;
    status: string;
  } | null>(null);

  const options = grains.data ?? [];
  const selected = useMemo(
    () => options.find((g) => g.import_id === importId) ?? null,
    [options, importId],
  );

  function onSelectImport(id: string) {
    setImportId(id);
    setResult(null);
    const g = options.find((o) => o.import_id === id);
    if (g?.period_start) setStart(g.period_start);
    if (g?.period_end) setEnd(g.period_end);
  }

  async function compare() {
    if (!organizationId || !importId || !start || !end) return;
    setBusy(true);
    setResult(null);
    try {
      const [clarity, source] = await Promise.all([
        supabase.rpc("gsc_daily_totals", { _org_id: organizationId, _start: start, _end: end }),
        supabase.rpc("gsc_import_daily_totals", {
          _import_id: importId,
          _start: start,
          _end: end,
        }),
      ]);
      if (clarity.error) throw clarity.error;
      if (source.error) throw source.error;

      const calculated = pick((clarity.data ?? [])[0] as Totals, metric);
      const sourceValue = pick((source.data ?? [])[0] as Totals, metric);
      const difference =
        calculated !== null && sourceValue !== null ? calculated - sourceValue : null;
      const status =
        difference === null
          ? "pending"
          : Math.abs(difference) <= tolerance(metric)
            ? "matched"
            : "mismatch";
      setResult({ calculated, source: sourceValue, difference, status });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    if (!organizationId || !result || !selected) return;
    setBusy(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("metric_validation_checks").insert({
        organization_id: organizationId,
        metric_key: metric,
        metric_version: 1,
        period_start: start,
        period_end: end,
        calculated_value: result.calculated,
        expected_value: result.source,
        difference: result.difference,
        status: result.status as never,
        reviewer_notes:
          [
            `Search Console export: ${selected.gsc_imports?.file_name ?? selected.source_file ?? "unknown file"}`,
            notes.trim(),
          ]
            .filter(Boolean)
            .join(" — ") || null,
        reviewed_by: user.user?.id ?? null,
        validated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success(
        "Validation check recorded. The metric definition stays provisional until an administrator promotes it.",
      );
      setNotes("");
      await qc.invalidateQueries({ queryKey: ["validation_checks", organizationId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Search Console validation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ClarityIQ recalculates the metric from active Dates-report grains using the same logic as
          Search Overview, and reads the source value straight out of the selected export. No value
          is invented, and a single matching period never marks a metric globally validated.
        </p>
      </div>

      {!options.length ? (
        <p className="text-sm text-muted-foreground">
          No Dates-report export is available yet. Import a Search Console Dates report first.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Import (Dates report)</Label>
              <Select value={importId} onValueChange={onSelectImport}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select an import" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((g) => (
                    <SelectItem key={g.id} value={g.import_id}>
                      {g.gsc_imports?.file_name ?? g.source_file ?? g.import_id}
                      {g.is_active ? "" : " (superseded)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Metric</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GSC_METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Period start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={compare} disabled={busy || !importId || !start || !end}>
              Compare
            </Button>
            {selected?.is_active === false ? (
              <span className="text-xs text-muted-foreground">
                This export is superseded, so ClarityIQ totals will not include it.
              </span>
            ) : null}
          </div>

          {result ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 text-left font-medium">Metric</th>
                      <th className="py-2 text-left font-medium">Import / file</th>
                      <th className="py-2 text-left font-medium">Period</th>
                      <th className="py-2 text-right font-medium">ClarityIQ</th>
                      <th className="py-2 text-right font-medium">Source export</th>
                      <th className="py-2 text-right font-medium">Difference</th>
                      <th className="py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2 text-foreground">
                        {GSC_METRICS.find((m) => m.key === metric)?.label}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {selected?.gsc_imports?.file_name ?? selected?.source_file ?? "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {format(new Date(`${start}T00:00:00`), "MMM d")} –{" "}
                        {format(new Date(`${end}T00:00:00`), "MMM d, yyyy")}
                      </td>
                      <td className="py-2 text-right text-foreground">
                        {display(metric, result.calculated)}
                      </td>
                      <td className="py-2 text-right text-foreground">
                        {display(metric, result.source)}
                      </td>
                      <td className="py-2 text-right text-foreground">
                        {result.difference === null ? "—" : display(metric, result.difference)}
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            result.status === "matched"
                              ? "rounded-full bg-success/10 px-2.5 py-1 text-xs text-success"
                              : result.status === "mismatch"
                                ? "rounded-full bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
                                : "rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                          }
                        >
                          {result.status}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything a reviewer should know about this comparison."
                />
              </div>

              <Button variant="secondary" onClick={record} disabled={busy}>
                Record validation check
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
