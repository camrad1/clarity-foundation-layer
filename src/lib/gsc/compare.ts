import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  subMonths,
  subYears,
} from "date-fns";

/**
 * Deterministic comparison-period resolution.
 *
 * A partial current month is never compared against a whole previous month:
 * the previous-month comparison is truncated to the same number of elapsed
 * days. If a comparison cannot be formed honestly, it is returned as null and
 * the UI states that no comparison is available.
 */

export type ComparisonMode = "prior_period" | "previous_month" | "previous_year";

export const COMPARISON_MODES: { value: ComparisonMode; label: string }[] = [
  { value: "prior_period", label: "Prior period" },
  { value: "previous_month", label: "Previous month" },
  { value: "previous_year", label: "Previous year" },
];

export type Period = { start: string; end: string };

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function periodLength(p: Period): number {
  return differenceInCalendarDays(parseISO(p.end), parseISO(p.start)) + 1;
}

export function resolveComparison(current: Period, mode: ComparisonMode): Period | null {
  const start = parseISO(current.start);
  const end = parseISO(current.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = periodLength(current);

  if (mode === "prior_period") {
    const prevEnd = addDays(start, -1);
    return { start: iso(addDays(prevEnd, -(days - 1))), end: iso(prevEnd) };
  }

  if (mode === "previous_month") {
    const prevStart = startOfMonth(subMonths(start, 1));
    const prevMonthEnd = endOfMonth(prevStart);
    // Partial month: compare only the same elapsed days.
    const isFullMonth =
      isSameDay(start, startOfMonth(start)) && isSameDay(end, endOfMonth(end));
    const elapsed = differenceInCalendarDays(end, startOfMonth(end));
    const prevEnd = isFullMonth ? prevMonthEnd : addDays(prevStart, elapsed);
    return { start: iso(prevStart), end: iso(prevEnd > prevMonthEnd ? prevMonthEnd : prevEnd) };
  }

  return { start: iso(subYears(start, 1)), end: iso(subYears(end, 1)) };
}

export function formatPeriod(p: Period | null): string {
  if (!p) return "No comparison period";
  return `${format(parseISO(p.start), "MMM d, yyyy")} – ${format(parseISO(p.end), "MMM d, yyyy")}`;
}

export function change(current: number | null, previous: number | null) {
  if (current === null || previous === null) return { absolute: null, percent: null };
  const absolute = current - previous;
  const percent = previous === 0 ? null : absolute / Math.abs(previous);
  return { absolute, percent };
}
