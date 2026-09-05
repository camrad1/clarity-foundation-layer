import { format, parseISO } from "date-fns";
import { Database, FileSpreadsheet } from "lucide-react";
import { formatPeriodLabel } from "@/lib/date-ranges";
import type { ApiCoverage, GscSource } from "@/lib/gsc/api-queries";
import type { Period } from "@/lib/gsc/compare";

const day = (d: string | null) => (d ? format(parseISO(d), "MMM d, yyyy") : "—");

/**
 * States where the numbers on screen come from. API rows carry real dates and
 * follow the global filter exactly; manual imports are fixed-period files kept
 * as a fallback and audit trail.
 */
export function GscSourceNote({
  source,
  coverage,
  period,
  comparison,
  grainLabel,
}: {
  source: GscSource;
  coverage: ApiCoverage;
  period: Period;
  comparison?: Period | null;
  grainLabel: string;
}) {
  if (source !== "api") return null;
  return (
    <p className="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Database className="size-3.5" /> Source: Search Console API
      </span>
      <span>
        {grainLabel} aggregated from daily rows for {formatPeriodLabel(period)}
        {comparison ? ` · compared with ${formatPeriodLabel(comparison)}` : ""}
      </span>
      {coverage.extent === "partial" ? (
        <span>
          API history covers {day(coverage.first)} – {day(coverage.last)}, so only the overlapping
          days are included.
        </span>
      ) : null}
    </p>
  );
}

export function GscManualSourceNote({ grainLabel }: { grainLabel: string }) {
  return (
    <p className="panel flex items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
      <FileSpreadsheet className="size-3.5" />
      <span className="font-medium text-foreground">Source: Manual Search Console import</span>
      <span>— no API {grainLabel.toLowerCase()} rows exist for this period yet.</span>
    </p>
  );
}
