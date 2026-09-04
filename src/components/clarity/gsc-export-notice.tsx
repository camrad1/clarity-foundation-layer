import { format, parseISO } from "date-fns";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPeriodLabel } from "@/lib/date-ranges";
import type { Period } from "@/lib/gsc/compare";
import type { GrainImport, ImportSelection } from "@/lib/gsc/queries";

const range = (g: GrainImport | null) =>
  g && g.period_start && g.period_end
    ? `${format(parseISO(g.period_start), "MMM d, yyyy")} – ${format(parseISO(g.period_end), "MMM d, yyyy")}`
    : "unknown period";

/**
 * Aggregate Search Console reports have no row level dates: each export is a
 * fixed-period total. This bar states exactly which export is on screen and
 * lets the user intentionally open another imported export. Nothing is ever
 * prorated to the globally selected range.
 */
export function GscExportNotice({
  selection,
  grainLabel,
  period,
  value,
  onChange,
}: {
  selection: ImportSelection;
  grainLabel: string;
  /** Globally selected date range, used to explain the match. */
  period: Period;
  /** Import id of a deliberately opened export, or null to follow the filter. */
  value: string | null;
  onChange: (importId: string | null) => void;
}) {
  const picker = selection.options.length ? (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">Report period</Label>
      <Select
        value={value ?? "auto"}
        onValueChange={(v) => onChange(v === "auto" ? null : v)}
      >
        <SelectTrigger size="sm" className="h-8 w-[19rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Follow the global date filter</SelectItem>
          {selection.options.map((g) => (
            <SelectItem key={g.id} value={g.import_id}>
              {range(g)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  if (!selection.current) {
    return (
      <div className="panel space-y-2 px-4 py-3 text-xs text-muted-foreground">
        <p className="inline-flex items-center gap-1.5">
          <Info className="size-3.5" />
          No {grainLabel.toLowerCase()} export matches {formatPeriodLabel(period)}. Import a Search
          Console export for this period to view {grainLabel.toLowerCase()} data, or open an
          existing export below — these reports are fixed-period totals and are never split across
          dates.
        </p>
        {picker}
      </div>
    );
  }

  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Info className="size-3.5" />
        Showing the {grainLabel} report for {range(selection.current)}
        {selection.coverage === "manual"
          ? ` — opened manually, not the globally selected ${formatPeriodLabel(period)}.`
          : " — matching your selected dates exactly."}
      </span>
      <span>
        {selection.comparison
          ? `Compared with the previous export (${range(selection.comparison)}).`
          : "No earlier export available to compare against."}
      </span>
      <span>Source file: {selection.current.gsc_imports?.file_name ?? "—"}</span>
      {picker}
    </div>
  );
}
