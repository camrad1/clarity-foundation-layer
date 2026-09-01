import { format, parseISO } from "date-fns";
import { Info } from "lucide-react";
import type { GrainImport, ImportSelection } from "@/lib/gsc/queries";

const range = (g: GrainImport | null) =>
  g && g.period_start && g.period_end
    ? `${format(parseISO(g.period_start), "MMM d, yyyy")} – ${format(parseISO(g.period_end), "MMM d, yyyy")}`
    : "unknown period";

/**
 * Aggregate Search Console reports cover a fixed exported period. This notice
 * always states the real period being shown so a global date filter can never
 * imply a precision the export does not have.
 */
export function GscExportNotice({
  selection,
  grainLabel,
}: {
  selection: ImportSelection;
  grainLabel: string;
}) {
  if (!selection.current) return null;
  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Info className="size-3.5" />
        Showing the {grainLabel} report for {range(selection.current)}
        {selection.coverage === "fixed_period"
          ? " — the closest export to your selected dates, shown for its full exported period rather than prorated."
          : "."}
      </span>
      <span>
        {selection.comparison
          ? `Compared with the previous export (${range(selection.comparison)}).`
          : "No earlier export available to compare against."}
      </span>
      <span>Source file: {selection.current.gsc_imports?.file_name ?? "—"}</span>
    </div>
  );
}
