/**
 * Flash reporting calendar.
 *
 * ONELIFE's operational Flash period is Sunday through Saturday. This is
 * deliberately independent of the generic analytics date presets in
 * `@/lib/date-ranges`.
 *
 * All helpers work on plain `YYYY-MM-DD` strings interpreted as calendar
 * dates (no timezone shifting).
 */

export type FlashWeek = { start: string; end: string };

const MS_DAY = 86_400_000;

function toUTC(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, day ?? 1));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fmt(new Date(toUTC(d).getTime() + n * MS_DAY));
}

export function todayISO(): string {
  const now = new Date();
  return fmt(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** The Sunday on or before `d`. Mirrors the database `flash_week_start()`. */
export function flashWeekStart(d: string): string {
  const dow = toUTC(d).getUTCDay(); // 0=Sun … 6=Sat
  return addDays(d, -dow);
}

export function flashWeekOf(d: string): FlashWeek {
  const start = flashWeekStart(d);
  return { start, end: addDays(start, 6) };
}

export function currentFlashWeek(today = todayISO()): FlashWeek {
  return flashWeekOf(today);
}

export function previousFlashWeek(today = todayISO()): FlashWeek {
  return flashWeekOf(addDays(flashWeekStart(today), -1));
}

export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: string): string {
  const s = toUTC(monthStart(d));
  return fmt(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)));
}

export function nextMonthStart(d: string): string {
  const s = toUTC(monthStart(d));
  return fmt(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1)));
}

/**
 * The Flash weeks reported inside a month: every Sunday–Saturday period whose
 * Saturday falls within the month. Mirrors the week loop in `wh_flash_report`.
 */
export function flashWeeksInMonth(d: string): FlashWeek[] {
  const ms = monthStart(d);
  const me = monthEnd(d);
  const out: FlashWeek[] = [];
  let start = flashWeekStart(ms);
  for (let i = 0; i < 8; i += 1) {
    const end = addDays(start, 6);
    if (end > me) break;
    if (end >= ms) out.push({ start, end });
    start = addDays(start, 7);
  }
  return out;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDay(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = toUTC(d);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** e.g. "Sun Aug 2 – Sat Aug 8, 2026" */
export function formatFlashRange(w: FlashWeek): string {
  const s = toUTC(w.start);
  const e = toUTC(w.end);
  return `Sun ${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} – Sat ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

export function formatMonth(d: string): string {
  const s = toUTC(monthStart(d));
  return `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
}

/** Month options for the picker: the given month and the 11 before it. */
export function recentMonths(today = todayISO(), count = 12): string[] {
  const base = toUTC(monthStart(today));
  return Array.from({ length: count }, (_, i) =>
    fmt(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1))),
  );
}
