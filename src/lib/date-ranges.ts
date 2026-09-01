import {
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";

export type DateRangePreset =
  | "current_month"
  | "previous_month"
  | "last_30_days"
  | "last_90_days"
  | "year_to_date"
  | "custom";

export type DateRangeValue = {
  preset: DateRangePreset;
  /** ISO yyyy-MM-dd, inclusive */
  start: string;
  /** ISO yyyy-MM-dd, inclusive */
  end: string;
};

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "current_month", label: "Current month" },
  { value: "previous_month", label: "Previous month" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "year_to_date", label: "Year to date" },
  { value: "custom", label: "Custom range" },
];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Resolves a preset into concrete dates. `today` is expected to already be
 * expressed in the reporting timezone (community timezone resolution happens
 * server-side at calculation time; see docs/timezone notes).
 */
export function resolvePreset(preset: DateRangePreset, today = new Date()): DateRangeValue {
  switch (preset) {
    case "previous_month": {
      const prev = subMonths(today, 1);
      return { preset, start: iso(startOfMonth(prev)), end: iso(endOfMonth(prev)) };
    }
    case "last_30_days":
      return { preset, start: iso(subDays(today, 29)), end: iso(today) };
    case "last_90_days":
      return { preset, start: iso(subDays(today, 89)), end: iso(today) };
    case "year_to_date":
      return { preset, start: iso(startOfYear(today)), end: iso(today) };
    case "current_month":
    case "custom":
    default:
      return { preset, start: iso(startOfMonth(today)), end: iso(today) };
  }
}

export function formatRangeLabel(range: DateRangeValue) {
  const preset = DATE_RANGE_PRESETS.find((p) => p.value === range.preset);
  const dates = `${format(new Date(`${range.start}T00:00:00`), "MMM d, yyyy")} – ${format(
    new Date(`${range.end}T00:00:00`),
    "MMM d, yyyy",
  )}`;
  return range.preset === "custom" ? dates : `${preset?.label} · ${dates}`;
}
