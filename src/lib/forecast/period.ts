/**
 * Forecast Tracker calendar.
 *
 * Weekly forecasts are recorded against Mondays. This is independent of both
 * the generic analytics presets and the Flash Sunday–Saturday period.
 */

const MS_DAY = 86_400_000;

function toUTC(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, day ?? 1));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** First day of the month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Last day of the month containing `date`. */
export function monthEnd(date: string): string {
  const d = toUTC(monthStart(date));
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Every Monday that falls inside the selected calendar month. */
export function forecastDatesForMonth(month: string): string[] {
  const start = toUTC(monthStart(month));
  const end = toUTC(monthEnd(month));
  const out: string[] = [];
  let cursor = new Date(start.getTime());
  // advance to the first Monday of the month
  while (cursor.getUTCDay() !== 1) cursor = new Date(cursor.getTime() + MS_DAY);
  while (cursor.getTime() <= end.getTime()) {
    out.push(fmt(cursor));
    cursor = new Date(cursor.getTime() + 7 * MS_DAY);
  }
  return out;
}

/** The forecast week (Mon–Sun) containing `date`, expressed by its Monday. */
export function forecastWeekOf(date: string): string {
  const d = toUTC(date);
  const shift = (d.getUTCDay() + 6) % 7;
  return fmt(new Date(d.getTime() - shift * MS_DAY));
}

/** A forecast date is locked once its Monday–Sunday week has fully passed. */
export function isPastForecastWeek(forecastDate: string, today = todayISO()): boolean {
  const end = fmt(new Date(toUTC(forecastDate).getTime() + 6 * MS_DAY));
  return end < today;
}

/** Recent months (most recent first) for the month selector. */
export function recentMonths(count = 18, from = todayISO()): string[] {
  const base = toUTC(monthStart(from));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(fmt(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1))));
  }
  return out;
}

export function formatMonthLabel(month: string): string {
  const d = toUTC(monthStart(month));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatShortDate(date: string): string {
  return toUTC(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
