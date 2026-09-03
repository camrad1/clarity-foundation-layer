/**
 * Parser for the historical "Weekly Occupancy Olympics" forecast workbook.
 *
 * The workbook is matrix shaped: one row per community, one column per weekly
 * forecast date, plus month-end reference columns. Nothing is inferred — a
 * cell is only turned into numbers when it is an unambiguous In/Out value.
 * Everything else is preserved verbatim as a historical source note.
 */
import * as XLSX from "xlsx";

export type ParsedCell = {
  forecastDate: string;
  dateLabel: string;
  projectedMoveIns: number | null;
  projectedMoveOuts: number | null;
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
  eomMonths: string[];
  communities: ParsedForecastCommunity[];
  numericRecords: number;
  noteRecords: number;
  ambiguousRecords: number;
  invalidDateColumns: string[];
  warnings: string[];
};

export function normalizeCommunityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ROLLUP = new Set(["total", "totals", "grand total", "portfolio", "all communities", "company"]);
export function isRollupName(name: string): boolean {
  return ROLLUP.has(normalizeCommunityName(name));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function serialToDate(serial: number): { y: number; m: number; d: number } | null {
  const parsed = (XLSX as any).SSF?.parse_date_code?.(serial);
  if (!parsed || !parsed.y) return null;
  return { y: parsed.y, m: parsed.m, d: parsed.d };
}

/** Interpret a header cell as a calendar date, or return null. */
function headerToDate(cell: any): string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`;
  }
  if (typeof cell === "number") {
    const d = serialToDate(cell);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const s = String(cell).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (md) {
    const year = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : new Date().getFullYear();
    return `${year}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return null;
}

/** Interpret a header cell as a month-end reference column, or return null. */
function headerToMonth(cell: any): string | null {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  if (!/eom|month\s*end|end\s*of\s*month|actual/i.test(s)) return null;
  const m = s.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?(\d{2,4})?/i,
  );
  if (!m) return null;
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
    m[1]!.toLowerCase(),
  );
  const yr = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : new Date().getFullYear();
  return `${yr}-${pad(idx + 1)}-01`;
}

/**
 * Interpret a forecast cell. Only a clean `in/out` pair produces numbers.
 * Excel frequently coerces "6/3" into a date; that case is recovered from the
 * serial value's month/day rather than guessed at.
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
    return {
      moveIns: raw.getUTCMonth() + 1,
      moveOuts: raw.getUTCDate(),
      note: null,
      ambiguous: false,
    };
  }
  if (typeof raw === "number") {
    if (formatted && /^\d{1,2}[/-]\d{1,2}/.test(formatted.trim())) {
      const d = serialToDate(raw);
      if (d) return { moveIns: d.m, moveOuts: d.d, note: null, ambiguous: false };
    }
    // a bare number carries no in/out semantics
    return { moveIns: null, moveOuts: null, note: String(raw), ambiguous: true };
  }
  const s = String(raw).trim();
  if (!s || s === "-" || s === "—") return { moveIns: null, moveOuts: null, note: null, ambiguous: false };
  const clean = s.match(/^(\d{1,3})\s*[/-]\s*(\d{1,3})$/);
  if (clean) {
    return { moveIns: Number(clean[1]), moveOuts: Number(clean[2]), note: null, ambiguous: false };
  }
  return { moveIns: null, moveOuts: null, note: s, ambiguous: true };
}

function toInt(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseForecastWorkbook(bytes: Uint8Array, fileName: string): ParsedForecastWorkbook {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true });
  const warnings: string[] = [];
  const invalidDateColumns: string[] = [];

  let best: {
    sheetName: string;
    headerRow: number;
    dateCols: { col: number; date: string; label: string }[];
    eomCols: { col: number; month: string; label: string }[];
    nameCol: number;
    raw: any[][];
    disp: any[][];
  } | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, blankrows: true }) as any[][];
    const disp = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, blankrows: true }) as any[][];
    for (let r = 0; r < Math.min(raw.length, 20); r += 1) {
      const row = raw[r] ?? [];
      const dateCols: { col: number; date: string; label: string }[] = [];
      const eomCols: { col: number; month: string; label: string }[] = [];
      for (let c = 0; c < row.length; c += 1) {
        const label = String((disp[r] ?? [])[c] ?? row[c] ?? "").trim();
        const month = headerToMonth(label);
        if (month) {
          eomCols.push({ col: c, month, label });
          continue;
        }
        const date = headerToDate(row[c]);
        if (date) dateCols.push({ col: c, date, label });
      }
      if (dateCols.length >= 2) {
        const nameCol = Math.max(0, Math.min(...dateCols.map((d) => d.col)) - 1);
        if (!best || dateCols.length > best.dateCols.length) {
          best = { sheetName, headerRow: r, dateCols, eomCols, nameCol, raw, disp };
        }
      }
    }
  }

  if (!best) {
    throw new Error(
      "Could not find a weekly forecast header row. The workbook needs a row of weekly forecast dates with community names to their left.",
    );
  }

  const communities: ParsedForecastCommunity[] = [];
  let numericRecords = 0;
  let noteRecords = 0;
  let ambiguousRecords = 0;

  for (let r = best.headerRow + 1; r < best.raw.length; r += 1) {
    const row = best.raw[r] ?? [];
    const dispRow = best.disp[r] ?? [];
    const sourceName = String(row[best.nameCol] ?? dispRow[best.nameCol] ?? "").trim();
    if (!sourceName) continue;
    if (isRollupName(sourceName)) continue;

    const cells: ParsedCell[] = [];
    for (const dc of best.dateCols) {
      const parsed = parseForecastCell(row[dc.col], dispRow[dc.col] as string | undefined);
      if (parsed.moveIns === null && parsed.moveOuts === null && !parsed.note) continue;
      if (parsed.moveIns !== null || parsed.moveOuts !== null) numericRecords += 1;
      if (parsed.note) noteRecords += 1;
      if (parsed.ambiguous) ambiguousRecords += 1;
      cells.push({
        forecastDate: dc.date,
        dateLabel: dc.label,
        projectedMoveIns: parsed.moveIns,
        projectedMoveOuts: parsed.moveOuts,
        sourceNote: parsed.note,
        ambiguous: parsed.ambiguous,
      });
    }

    const eom: ParsedEomCell[] = [];
    for (const ec of best.eomCols) {
      const value = row[ec.col];
      if (value === null || value === undefined || value === "") continue;
      const parsed = parseForecastCell(value, dispRow[ec.col] as string | undefined);
      eom.push({
        month: ec.month,
        monthLabel: ec.label,
        moveIns: parsed.moveIns ?? toInt(value),
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

  return {
    fileName,
    sheetName: best.sheetName,
    forecastDates: best.dateCols.map((d) => d.date),
    eomMonths: [...new Set(best.eomCols.map((e) => e.month))],
    communities,
    numericRecords,
    noteRecords,
    ambiguousRecords,
    invalidDateColumns,
    warnings,
  };
}
