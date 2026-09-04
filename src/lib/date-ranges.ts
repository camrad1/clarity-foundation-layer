import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
  subYears,
} from "date-fns";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "last_week"
  | "last_month"
  | "last_quarter"
  | "last_year"
  | "trailing_7"
  | "trailing_14"
  | "trailing_30"
  | "trailing_60"
  | "trailing_90"
  | "trailing_120"
  | "trailing_180"
  | "trailing_365"
  | "week_to_date"
  | "month_to_date"
  | "quarter_to_date"
  | "year_to_date"
  | "custom";

export type DateRangeValue = {
  preset: DateRangePreset;
  /** ISO yyyy-MM-dd, inclusive */
  start: string;
  /** ISO yyyy-MM-dd, inclusive */
  end: string;
};

export const DATE_RANGE_PRESET_GROUPS: {
  label: string;
  presets: { value: DateRangePreset; label: string }[];
}[] = [
  {
    label: "Current",
    presets: [
      { value: "today", label: "Today" },
      { value: "yesterday", label: "Yesterday" },
      { value: "this_week", label: "This Week" },
      { value: "this_month", label: "This Month" },
      { value: "this_quarter", label: "This Quarter" },
      { value: "this_year", label: "This Year" },
    ],
  },
  {
    label: "Previous",
    presets: [
      { value: "last_week", label: "Last Week" },
      { value: "last_month", label: "Last Month" },
      { value: "last_quarter", label: "Last Quarter" },
      { value: "last_year", label: "Last Year" },
    ],
  },
  {
    label: "Trailing",
    presets: [
      { value: "trailing_7", label: "Trailing 7 Days" },
      { value: "trailing_14", label: "Trailing 14 Days" },
      { value: "trailing_30", label: "Trailing 30 Days" },
      { value: "trailing_60", label: "Trailing 60 Days" },
      { value: "trailing_90", label: "Trailing 90 Days" },
      { value: "trailing_120", label: "Trailing 120 Days" },
      { value: "trailing_180", label: "Trailing 180 Days" },
      { value: "trailing_365", label: "Trailing 365 Days" },
    ],
  },
  {
    label: "To date",
    presets: [
      { value: "week_to_date", label: "Week to Date" },
      { value: "month_to_date", label: "Month to Date" },
      { value: "quarter_to_date", label: "Quarter to Date" },
      { value: "year_to_date", label: "Year to Date" },
      { value: "custom", label: "Custom Range" },
    ],
  },
];

export const DATE_RANGE_PRESETS = DATE_RANGE_PRESET_GROUPS.flatMap((g) => g.presets);

/** Presets that used to exist before the richer picker; kept so persisted state stays valid. */
const LEGACY_PRESETS: Record<string, DateRangePreset> = {
  current_month: "this_month",
  previous_month: "last_month",
  last_30_days: "trailing_30",
  last_90_days: "trailing_90",
};

export function normalizePreset(preset: string | undefined): DateRangePreset {
  if (!preset) return "this_month";
  if (LEGACY_PRESETS[preset]) return LEGACY_PRESETS[preset];
  return DATE_RANGE_PRESETS.some((p) => p.value === preset)
    ? (preset as DateRangePreset)
    : "this_month";
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const WEEK = { weekStartsOn: 0 } as const; // Sunday, matching ClarityIQ reporting weeks

const trailing = (days: number, today: Date, preset: DateRangePreset): DateRangeValue => ({
  preset,
  start: iso(subDays(today, days - 1)),
  end: iso(today),
});

/**
 * Resolves a preset into concrete dates using calendar-period semantics
 * (never a fixed day subtraction where a calendar boundary is meaningful).
 */
export function resolvePreset(preset: DateRangePreset, today = new Date()): DateRangeValue {
  switch (preset) {
    case "today":
      return { preset, start: iso(today), end: iso(today) };
    case "yesterday": {
      const d = subDays(today, 1);
      return { preset, start: iso(d), end: iso(d) };
    }
    case "this_week":
      return { preset, start: iso(startOfWeek(today, WEEK)), end: iso(endOfWeek(today, WEEK)) };
    case "this_month":
      return { preset, start: iso(startOfMonth(today)), end: iso(endOfMonth(today)) };
    case "this_quarter":
      return { preset, start: iso(startOfQuarter(today)), end: iso(endOfQuarter(today)) };
    case "this_year":
      return { preset, start: iso(startOfYear(today)), end: iso(endOfYear(today)) };
    case "last_week": {
      const d = subWeeks(today, 1);
      return { preset, start: iso(startOfWeek(d, WEEK)), end: iso(endOfWeek(d, WEEK)) };
    }
    case "last_month": {
      const d = subMonths(today, 1);
      return { preset, start: iso(startOfMonth(d)), end: iso(endOfMonth(d)) };
    }
    case "last_quarter": {
      const d = subQuarters(today, 1);
      return { preset, start: iso(startOfQuarter(d)), end: iso(endOfQuarter(d)) };
    }
    case "last_year": {
      const d = subYears(today, 1);
      return { preset, start: iso(startOfYear(d)), end: iso(endOfYear(d)) };
    }
    case "trailing_7":
      return trailing(7, today, preset);
    case "trailing_14":
      return trailing(14, today, preset);
    case "trailing_30":
      return trailing(30, today, preset);
    case "trailing_60":
      return trailing(60, today, preset);
    case "trailing_90":
      return trailing(90, today, preset);
    case "trailing_120":
      return trailing(120, today, preset);
    case "trailing_180":
      return trailing(180, today, preset);
    case "trailing_365":
      return trailing(365, today, preset);
    case "week_to_date":
      return { preset, start: iso(startOfWeek(today, WEEK)), end: iso(today) };
    case "quarter_to_date":
      return { preset, start: iso(startOfQuarter(today)), end: iso(today) };
    case "year_to_date":
      return { preset, start: iso(startOfYear(today)), end: iso(today) };
    case "month_to_date":
    case "custom":
    default:
      return { preset, start: iso(startOfMonth(today)), end: iso(today) };
  }
}

/**
 * Format a SQL date-only value ("YYYY-MM-DD") as the literal calendar date.
 * Never pass a timestamp here, and never build date-only values with
 * `new Date("YYYY-MM-DD")` — that parses as UTC midnight and shifts a day in
 * western timezones.
 */
export function formatDateOnly(value: string | null | undefined, pattern = "MMM d, yyyy") {
  if (!value) return "—";
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "—";
  return format(new Date(`${day}T00:00:00`), pattern);
}

export function formatRangeLabel(range: DateRangeValue) {
  const preset = DATE_RANGE_PRESETS.find((p) => p.value === range.preset);
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const dates =
    range.start === range.end
      ? format(start, "MMM d, yyyy")
      : `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  return range.preset === "custom" ? dates : `${preset?.label} · ${dates}`;
}

/* ------------------------------------------------------------------ */
/* Comparison periods                                                  */
/* ------------------------------------------------------------------ */

export type ComparisonPeriodMode =
  | "none"
  | "day_over_day"
  | "week_over_week"
  | "month_over_month"
  | "quarter_over_quarter"
  | "year_over_year";

export const COMPARISON_PERIOD_MODES: { value: ComparisonPeriodMode; label: string }[] = [
  { value: "none", label: "No comparison" },
  { value: "day_over_day", label: "Day over Day" },
  { value: "week_over_week", label: "Week over Week" },
  { value: "month_over_month", label: "Month over Month" },
  { value: "quarter_over_quarter", label: "Quarter over Quarter" },
  { value: "year_over_year", label: "Year over Year" },
];

export type Period = { start: string; end: string };

const parse = (s: string) => new Date(`${s}T00:00:00`);

const isFullSpan = (start: Date, end: Date, s: (d: Date) => Date, e: (d: Date) => Date) =>
  iso(s(start)) === iso(start) && iso(e(end)) === iso(end);

/**
 * Calendar-aware comparison resolution. A full calendar period shifts to the
 * whole previous calendar period; anything else shifts by the same calendar
 * unit while preserving the selection length.
 */
export function resolveComparisonPeriod(
  range: Period,
  mode: ComparisonPeriodMode,
): Period | null {
  if (mode === "none") return null;
  const start = parse(range.start);
  const end = parse(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = differenceInCalendarDays(end, start) + 1;

  const shifted = (s: Date) => ({ start: iso(s), end: iso(addDays(s, days - 1)) });

  switch (mode) {
    case "day_over_day":
      return shifted(subDays(start, days));
    case "week_over_week":
      return isFullSpan(start, end, (d) => startOfWeek(d, WEEK), (d) => endOfWeek(d, WEEK))
        ? {
            start: iso(startOfWeek(subWeeks(start, 1), WEEK)),
            end: iso(endOfWeek(subWeeks(end, 1), WEEK)),
          }
        : shifted(subWeeks(start, 1));
    case "month_over_month":
      return isFullSpan(start, end, startOfMonth, endOfMonth)
        ? { start: iso(startOfMonth(subMonths(start, 1))), end: iso(endOfMonth(subMonths(end, 1))) }
        : shifted(subMonths(start, 1));
    case "quarter_over_quarter":
      return isFullSpan(start, end, startOfQuarter, endOfQuarter)
        ? {
            start: iso(startOfQuarter(subQuarters(start, 1))),
            end: iso(endOfQuarter(subQuarters(end, 1))),
          }
        : shifted(subQuarters(start, 1));
    case "year_over_year":
      return isFullSpan(start, end, startOfYear, endOfYear)
        ? { start: iso(startOfYear(subYears(start, 1))), end: iso(endOfYear(subYears(end, 1))) }
        : { start: iso(subYears(start, 1)), end: iso(subYears(end, 1)) };
    default:
      return null;
  }
}

export function comparisonModeLabel(mode: ComparisonPeriodMode) {
  return COMPARISON_PERIOD_MODES.find((m) => m.value === mode)?.label ?? "No comparison";
}

/** "vs prior month" style suffix used on KPI cards. */
export function comparisonSuffix(mode: ComparisonPeriodMode) {
  switch (mode) {
    case "day_over_day":
      return "vs prior day";
    case "week_over_week":
      return "vs prior week";
    case "month_over_month":
      return "vs prior month";
    case "quarter_over_quarter":
      return "vs prior quarter";
    case "year_over_year":
      return "vs prior year";
    default:
      return "";
  }
}

export function formatPeriodLabel(p: Period | null) {
  if (!p) return "No comparison period";
  const start = parse(p.start);
  const end = parse(p.end);
  return p.start === p.end
    ? format(start, "MMM d, yyyy")
    : `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}
