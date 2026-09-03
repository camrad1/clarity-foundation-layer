/**
 * Parser for the historical "Weekly Occupancy Olympics" forecast workbook.
 *
 * Detected layout (tolerant — every row index is discovered, not hardcoded):
 *   row N-1  month group header:  November | ... | EOM | December | ... | EOM
 *   row N    weekly forecast dates (one per In/Out column)
 *   row N+1  sub headers:         In/Out | Stretch (or Goal) | ...
 *   rows     one per community, community name in the column left of the dates
 *
 * Nothing is inferred: a cell only becomes numbers when it is an unambiguous
 * in/out pair (or an unambiguous single-number stretch/goal). Everything else
 * is preserved verbatim as a historical source note.
 */
import * as XLSX from "xlsx";

export type ParsedCell = {
  forecastDate: string;
  dateLabel: string;
  monthLabel: string;
  projectedMoveIns: number | null;
  projectedMoveOuts: number | null;
  stretchGoal: number | null;
  sourceNote: string | null;
  ambiguous: boolean;
};

export type ParsedEomCell = {
  month: string;
  monthLabel: string;
  moveIns: number | null;
  moveOuts: number | null;
  sourceNote: string | null;
};

export type ParsedForecastCommunity = {
  sourceName: string;
  normalizedName: string;
  cells: ParsedCell[];
  eom: ParsedEomCell[];
};

export type ParsedForecastWorkbook = {
  fileName: string;
  sheetName: string;
  forecastDates: string[];
  months: { month: string; label: string; dates: string[] }[];
  eomMonths: string[];
  communities: ParsedForecastCommunity[];
  numericRecords: number;
  stretchRecords: number;
  noteRecords: number;
  ambiguousRecords: number;
  ambiguousSamples: { community: string; date: string; text: string }[];
  correctedDateColumns: string[];
  invalidDateColumns: string[];
  warnings: string[];
};

export function normalizeCommunityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ROLLUP = new Set([
  "total",
  "totals",
  "grand total",
  "portfolio",
  "all communities",
  "company",
  "in out net",
  "net",
]);
export function isRollupName(name: string): boolean {
  const n = normalizeCommunityName(name);
  if (ROLLUP.has(n)) return true;
  return /^in out/.test(n) || /\bnet\b\s*\+?\/?-?$/.test(n);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Excel serial date -> calendar date (1900 date system, incl. the leap bug). */
function serialToDate(serial: number): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 200000) return null;
  const whole = Math.floor(serial);
  const ms = Date.UTC(1899, 11, 30) + whole * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Interpret a header cell as a calendar date, or return null. */
function headerToDate(cell: any): { y: number; m: number; d: number } | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return { y: cell.getUTCFullYear(), m: cell.getUTCMonth() + 1, d: cell.getUTCDate() };
  }
  if (typeof cell === "number") return serialToDate(cell);
  const s = String(cell).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const md = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (md) {
    const year = Number(md[3]!.length === 2 ? `20${md[3]}` : md[3]);
    return { y: year, m: Number(md[1]), d: Number(md[2]) };
  }
  // free text must look like a real date ("3-Nov", "Nov 3 2025") — bare "2/4"
  // or prose such as "2 for Jan" is never treated as a header date
  const monthish = /^(\d{1,2}[-\s])?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*([-\s,]+\d{1,4})*$/i;
  if (!monthish.test(s)) return null;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return null;
}

/** Month name in a group header cell, or null. */
function monthNameIndex(label: string): number | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  const idx = MONTHS.findIndex((m) => s === m || s === m.slice(0, 3) || s.startsWith(`${m} `));
  return idx >= 0 ? idx : null;
}

function isEomLabel(label: string): boolean {
  return /^(eom|month\s*end|end\s*of\s*month|actual)/i.test(label.trim());
}

/**
 * Interpret an In/Out forecast cell. Only a clean `in/out` pair produces
 * numbers. Excel frequently coerces "6/3" into a date; that case is recovered
 * from the serial value's month/day rather than guessed at.
 */
export function parseForecastCell(raw: any, formatted?: string): {
  moveIns: number | null;
  moveOuts: number | null;
  note: string | null;
  ambiguous: boolean;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { moveIns: null, moveOuts: null, note: null, ambiguous: false };
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { moveIns: raw.getUTCMonth() + 1, moveOuts: raw.getUTCDate(), note: null, ambiguous: false };
  }
  if (typeof raw === "number") {
    if (formatted && /^\d{1,2}[/-]\d{1,2}/.test(formatted.trim())) {
      const d = serialToDate(raw);
      if (d) return { moveIns: d.m, moveOuts: d.d, note: null, ambiguous: false };
    }
    // a bare number carries no in/out semantics
    return { moveIns: null, moveOuts: null, note: String(raw), ambiguous: true };
  }
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "—") return { moveIns: null, moveOuts: null, note: null, ambiguous: false };
  const clean = s.match(/^(\d{1,3})\s*[/-]\s*(\d{1,3})$/);
  if (clean) return { moveIns: Number(clean[1]), moveOuts: Number(clean[2]), note: null, ambiguous: false };
  // "2/6 -4" style: clean pair followed by extra commentary
  const withTrailer = s.match(/^(\d{1,3})\s*\/\s*(\d{1,3})\s+(.+)$/);
  if (withTrailer) {
    return {
      moveIns: Number(withTrailer[1]),
      moveOuts: Number(withTrailer[2]),
      note: withTrailer[3]!.trim(),
      ambiguous: false,
    };
  }
  return { moveIns: null, moveOuts: null, note: s, ambiguous: true };
}

/**
 * Interpret a Stretch/Goal cell. Only an unambiguous single target number
 * becomes a stretch goal; anything else (paired goals, prose, occupancy
 * targets) is preserved verbatim as a note.
 */
export function parseStretchCell(raw: any, formatted?: string): { stretch: number | null; note: string | null } {
  if (raw === null || raw === undefined || raw === "") return { stretch: null, note: null };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { stretch: null, note: formatted?.trim() || raw.toISOString().slice(0, 10) };
  }
  if (typeof raw === "number") {
    if (formatted && /^\d{1,2}[/-]\d{1,2}/.test(formatted.trim())) return { stretch: null, note: formatted.trim() };
    return Number.isInteger(raw) && raw >= 0 && raw <= 200
      ? { stretch: raw, note: null }
      : { stretch: null, note: String(raw) };
  }
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return { stretch: null, note: null };
  const m = s.match(/^(?:stretch|goal)?\s*(?:of\s*|is\s*)?(\d{1,3})(?:\s*(?:in|ins|move\s*ins?))?\.?$/i);
  if (m) return { stretch: Number(m[1]), note: null };
  return { stretch: null, note: s };
}

export function parseForecastWorkbook(bytes: Uint8Array, fileName: string): ParsedForecastWorkbook {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true });
  const warnings: string[] = [];
  const invalidDateColumns: string[] = [];
  const correctedDateColumns: string[] = [];

  type DateCol = { col: number; stretchCol: number | null; raw: { y: number; m: number; d: number }; label: string };

  let best:
    | {
        sheetName: string;
        headerRow: number;
        dateCols: DateCol[];
        eomCols: { col: number }[];
        groupRow: number;
        nameCol: number;
        raw: any[][];
        disp: any[][];
      }
    | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, blankrows: true }) as any[][];
    const disp = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, blankrows: true }) as any[][];
    for (let r = 0; r < Math.min(raw.length, 20); r += 1) {
      const row = raw[r] ?? [];
      const subRow = disp[r + 1] ?? [];
      const dateCols: DateCol[] = [];
      for (let c = 0; c < row.length; c += 1) {
        const parsed = headerToDate(row[c]);
        if (!parsed) continue;
        const nextLabel = String(subRow[c + 1] ?? "").trim();
        const stretchCol = /stretch|goal/i.test(nextLabel) ? c + 1 : null;
        dateCols.push({
          col: c,
          stretchCol,
          raw: parsed,
          label: String((disp[r] ?? [])[c] ?? "").trim(),
        });
      }
      if (dateCols.length >= 2 && (!best || dateCols.length > best.dateCols.length)) {
        const nameCol = Math.max(0, Math.min(...dateCols.map((d) => d.col)) - 1);
        const groupRow = Math.max(0, r - 1);
        const eomCols: { col: number }[] = [];
        const gRow = disp[groupRow] ?? [];
        for (let c = 0; c < gRow.length; c += 1) {
          if (isEomLabel(String(gRow[c] ?? ""))) eomCols.push({ col: c });
        }
        best = { sheetName, headerRow: r, dateCols, eomCols, groupRow, nameCol, raw, disp };
      }
    }
  }

  if (!best) {
    throw new Error(
      "Could not find a weekly forecast header row. The workbook needs a row of weekly forecast dates with community names to their left.",
    );
  }

  // --- Month groups -------------------------------------------------------
  // The group header row names each month in calendar order. Source date cells
  // occasionally carry a typo'd year (e.g. January dates typed as 2025), so the
  // authoritative month/year comes from walking the group sequence forward from
  // the first group's own dates.
  const groupRowVals = best.disp[best.groupRow] ?? [];
  type Group = { startCol: number; endCol: number; label: string; monthIdx: number | null; year: number; month: number };
  const rawGroups: { startCol: number; label: string; monthIdx: number | null }[] = [];
  for (let c = 0; c < groupRowVals.length; c += 1) {
    const label = String(groupRowVals[c] ?? "").trim();
    if (!label || isEomLabel(label)) continue;
    const idx = monthNameIndex(label);
    if (idx === null) continue;
    rawGroups.push({ startCol: c, label, monthIdx: idx });
  }

  const groups: Group[] = [];
  if (rawGroups.length) {
    // seed year from the dates in the first group whose month matches its label
    const firstStart = rawGroups[0]!.startCol;
    const firstEnd = rawGroups[1]?.startCol ?? Number.MAX_SAFE_INTEGER;
    const seedDate = best.dateCols.find(
      (d) => d.col >= firstStart && d.col < firstEnd && d.raw.m === (rawGroups[0]!.monthIdx! + 1),
    );
    let year = seedDate?.raw.y ?? best.dateCols[0]?.raw.y ?? new Date().getFullYear();
    let prevMonthIdx: number | null = null;
    for (let i = 0; i < rawGroups.length; i += 1) {
      const g = rawGroups[i]!;
      const monthIdx = g.monthIdx!;
      if (prevMonthIdx !== null && monthIdx <= prevMonthIdx) year += 1;
      prevMonthIdx = monthIdx;
      groups.push({
        startCol: g.startCol,
        endCol: (rawGroups[i + 1]?.startCol ?? Number.MAX_SAFE_INTEGER) - 1,
        label: g.label,
        monthIdx,
        year,
        month: monthIdx + 1,
      });
    }
  }

  function groupFor(col: number): Group | null {
    return groups.find((g) => col >= g.startCol && col <= g.endCol) ?? null;
  }

  // resolve each date column against its month group
  const resolved: (DateCol & { date: string; monthLabel: string; monthKey: string })[] = [];
  for (const dc of best.dateCols) {
    const g = groupFor(dc.col);
    let { y, m, d } = dc.raw;
    if (g) {
      if (y !== g.year || m !== g.month) {
        correctedDateColumns.push(`${y}-${pad(m)}-${pad(d)} → ${g.year}-${pad(g.month)}-${pad(d)} (${g.label})`);
        y = g.year;
        m = g.month;
      }
    }
    const date = `${y}-${pad(m)}-${pad(d)}`;
    if (Number.isNaN(Date.parse(date))) {
      invalidDateColumns.push(dc.label || date);
      continue;
    }
    resolved.push({
      ...dc,
      date,
      monthLabel: g?.label ?? `${y}-${pad(m)}`,
      monthKey: `${y}-${pad(m)}-01`,
    });
  }

  // EOM columns take the month of the group they sit in (or the group to their left)
  const eomCols = best.eomCols
    .map((e) => {
      const g = groupFor(e.col) ?? [...groups].reverse().find((x) => x.startCol < e.col) ?? null;
      return g ? { col: e.col, month: `${g.year}-${pad(g.month)}-01`, label: g.label } : null;
    })
    .filter(Boolean) as { col: number; month: string; label: string }[];

  const communities: ParsedForecastCommunity[] = [];
  let numericRecords = 0;
  let stretchRecords = 0;
  let noteRecords = 0;
  let ambiguousRecords = 0;
  const ambiguousSamples: { community: string; date: string; text: string }[] = [];

  for (let r = best.headerRow + 2; r < best.raw.length; r += 1) {
    const row = best.raw[r] ?? [];
    const dispRow = best.disp[r] ?? [];
    const sourceName = String(row[best.nameCol] ?? dispRow[best.nameCol] ?? "").trim();
    if (!sourceName) continue;
    if (isRollupName(sourceName)) continue;

    const cells: ParsedCell[] = [];
    for (const dc of resolved) {
      const parsed = parseForecastCell(row[dc.col], dispRow[dc.col] as string | undefined);
      const stretch =
        dc.stretchCol !== null
          ? parseStretchCell(row[dc.stretchCol], dispRow[dc.stretchCol] as string | undefined)
          : { stretch: null, note: null };

      const noteParts: string[] = [];
      if (parsed.note) noteParts.push(parsed.note);
      if (stretch.note) noteParts.push(`Stretch/Goal: ${stretch.note}`);
      const sourceNote = noteParts.length ? noteParts.join(" · ") : null;

      if (parsed.moveIns === null && parsed.moveOuts === null && stretch.stretch === null && !sourceNote) continue;
      if (parsed.moveIns !== null || parsed.moveOuts !== null) numericRecords += 1;
      if (stretch.stretch !== null) stretchRecords += 1;
      if (sourceNote) noteRecords += 1;
      if (parsed.ambiguous) {
        ambiguousRecords += 1;
        if (ambiguousSamples.length < 40 && parsed.note) {
          ambiguousSamples.push({ community: sourceName, date: dc.date, text: parsed.note });
        }
      }

      cells.push({
        forecastDate: dc.date,
        dateLabel: dc.label,
        monthLabel: dc.monthLabel,
        projectedMoveIns: parsed.moveIns,
        projectedMoveOuts: parsed.moveOuts,
        stretchGoal: stretch.stretch,
        sourceNote,
        ambiguous: parsed.ambiguous,
      });
    }

    const eom: ParsedEomCell[] = [];
    for (const ec of eomCols) {
      const value = row[ec.col];
      if (value === null || value === undefined || value === "") continue;
      const parsed = parseForecastCell(value, dispRow[ec.col] as string | undefined);
      eom.push({
        month: ec.month,
        monthLabel: ec.label,
        moveIns: parsed.moveIns,
        moveOuts: parsed.moveOuts,
        sourceNote: parsed.note,
      });
    }

    if (cells.length || eom.length) {
      communities.push({ sourceName, normalizedName: normalizeCommunityName(sourceName), cells, eom });
    }
  }

  if (!communities.length) warnings.push("No community rows were found beneath the forecast header row.");
  if (ambiguousRecords) {
    warnings.push(
      `${ambiguousRecords} cell(s) are not a clean in/out value. They are preserved as historical notes and no numbers are inferred from them.`,
    );
  }
  if (correctedDateColumns.length) {
    warnings.push(
      `${correctedDateColumns.length} forecast date(s) disagreed with their month heading and were aligned to the heading (e.g. ${correctedDateColumns[0]}).`,
    );
  }

  const monthMap = new Map<string, { month: string; label: string; dates: string[] }>();
  for (const dc of resolved) {
    const entry = monthMap.get(dc.monthKey) ?? { month: dc.monthKey, label: dc.monthLabel, dates: [] };
    entry.dates.push(dc.date);
    monthMap.set(dc.monthKey, entry);
  }

  return {
    fileName,
    sheetName: best.sheetName,
    forecastDates: resolved.map((d) => d.date),
    months: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    eomMonths: [...new Set(eomCols.map((e) => e.month))].sort(),
    communities,
    numericRecords,
    stretchRecords,
    noteRecords,
    ambiguousRecords,
    ambiguousSamples,
    correctedDateColumns,
    invalidDateColumns,
    warnings,
  };
}
