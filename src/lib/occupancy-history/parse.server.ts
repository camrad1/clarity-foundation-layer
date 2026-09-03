/**
 * Parser for the official "Occupancy Flash ... DOD" day-over-day workbooks.
 *
 * The workbooks are matrix shaped: one column per calendar day starting in
 * column D of the date header row, and one block of metric rows per community.
 * Nothing here is inferred or interpolated — a day that has no value in the
 * workbook simply produces no record.
 */
import * as XLSX from "xlsx";

/** Hard server-side cutoff. Nothing on or after this date may be imported. */
export const OCC_HISTORY_CUTOFF = "2026-09-02";

export type ParsedDay = {
  date: string;
  dateLabel: string;
  beginningOccupied: number | null;
  moveIns: number | null;
  moveOuts: number | null;
  net: number | null;
  endingOccupied: number | null;
  beginningPct: number | null;
  endingPct: number | null;
  totalUnits: number | null;
  validationStatus: string;
  notes: string | null;
};

export type ParsedCommunity = {
  sourceName: string;
  normalizedName: string;
  days: ParsedDay[];
  firstDate: string | null;
  lastDate: string | null;
  futureRowsSkipped: number;
};

export type ParsedWorkbook = {
  sheetName: string;
  fileName: string;
  columns: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  year: number | null;
  communities: ParsedCommunity[];
  rollupRowsSkipped: number;
  futureRowsSkipped: number;
  unparsedDateColumns: number;
  warnings: string[];
};

export function normalizeCommunityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ROLLUP_NAMES = new Set(["total", "totals", "grand total", "portfolio", "all communities"]);

export function isRollupName(name: string): boolean {
  return ROLLUP_NAMES.has(normalizeCommunityName(name));
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,$\s]/g, "");
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Percent cells arrive as "87%" strings or as 0.87 numbers. Stored as a fraction. */
function toPct(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? (v > 1.5 ? v / 100 : v) : null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s.replace(/[%\s,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return s.includes("%") || n > 1.5 ? n / 100 : n;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Excel serial or mm/dd/yyyy text -> ISO date string, or null when unparsable. */
function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return null;
}

const METRICS: Record<string, keyof ParsedDay> = {
  "beginning occupancy #": "beginningOccupied",
  "mis": "moveIns",
  "mos": "moveOuts",
  "net mis mos": "net",
  "ending occupancy #": "endingOccupied",
  "beginning occupancy %": "beginningPct",
  "ending occupancy %": "endingPct",
};

function metricKey(label: string): keyof ParsedDay | null {
  const k = label
    .toLowerCase()
    .replace(/[:\s]+/g, " ")
    .replace(/[#]/g, "#")
    .replace(/[^a-z0-9#% ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return METRICS[k] ?? null;
}

export function parseOccupancyWorkbook(
  bytes: Uint8Array,
  fileName: string,
  cutoff: string = OCC_HISTORY_CUTOFF,
): ParsedWorkbook {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0]!;
  const sheet = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const warnings: string[] = [];

  // Locate the date header row: the row whose column B says "Community".
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    const b = rows[r]?.[1];
    if (typeof b === "string" && b.trim().toLowerCase() === "community") {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) throw new Error(`Could not find the "Community" header row in ${fileName}`);

  const header = rows[headerRow] ?? [];
  const dateCols: { col: number; date: string; label: string }[] = [];
  let unparsedDateColumns = 0;
  for (let c = 2; c < header.length; c += 1) {
    const raw = header[c];
    if (raw === null || raw === undefined || raw === "") continue;
    const iso = toIsoDate(raw);
    if (!iso) {
      unparsedDateColumns += 1;
      continue;
    }
    dateCols.push({ col: c, date: iso, label: String(raw) });
  }
  if (dateCols.length === 0) throw new Error(`No date columns found in ${fileName}`);

  const communities: ParsedCommunity[] = [];
  let rollupRowsSkipped = 0;
  let futureRowsSkipped = 0;
  let current: { name: string; metrics: Map<keyof ParsedDay, unknown[]> } | null = null;
  const blocks: { name: string; metrics: Map<keyof ParsedDay, unknown[]> }[] = [];

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const name = typeof row[1] === "string" ? row[1].trim() : "";
    const label = typeof row[2] === "string" ? row[2].trim() : "";
    if (name) {
      current = { name, metrics: new Map() };
      blocks.push(current);
      continue;
    }
    if (!current || !label) continue;
    const key = metricKey(label);
    if (!key) continue;
    current.metrics.set(key, row);
  }

  for (const block of blocks) {
    if (isRollupName(block.name)) {
      rollupRowsSkipped += 1;
      continue;
    }
    const days: ParsedDay[] = [];
    let blockFuture = 0;
    let prevEnding: number | null = null;
    for (const dc of dateCols) {
      const cell = (key: keyof ParsedDay) => (block.metrics.get(key) ?? [])[dc.col];
      const beginningOccupied = toNumber(cell("beginningOccupied"));
      const moveIns = toNumber(cell("moveIns"));
      const moveOuts = toNumber(cell("moveOuts"));
      const net = toNumber(cell("net"));
      const endingOccupied = toNumber(cell("endingOccupied"));
      const beginningPct = toPct(cell("beginningPct"));
      const endingPct = toPct(cell("endingPct"));

      const empty =
        beginningOccupied === null &&
        moveIns === null &&
        moveOuts === null &&
        net === null &&
        endingOccupied === null &&
        beginningPct === null &&
        endingPct === null;
      if (empty) {
        prevEnding = null;
        continue;
      }
      if (dc.date >= cutoff) {
        blockFuture += 1;
        futureRowsSkipped += 1;
        continue;
      }

      const notes: string[] = [];
      if (net !== null && moveIns !== null && moveOuts !== null && Math.abs(net - (moveIns - moveOuts)) > 0.001) {
        notes.push("Net does not equal MIs − MOs in the source workbook");
      }
      if (
        prevEnding !== null &&
        beginningOccupied !== null &&
        Math.abs(prevEnding - beginningOccupied) > 0.001
      ) {
        notes.push("Beginning occupancy does not match the previous day's ending occupancy");
      }
      if (endingPct === null) notes.push("No ending occupancy percentage in the source workbook");

      const totalUnits =
        endingOccupied !== null && endingPct !== null && endingPct > 0
          ? Math.round(endingOccupied / endingPct)
          : null;

      days.push({
        date: dc.date,
        dateLabel: dc.label,
        beginningOccupied,
        moveIns,
        moveOuts,
        net,
        endingOccupied,
        beginningPct,
        endingPct,
        totalUnits,
        validationStatus: notes.length ? "warning" : "ok",
        notes: notes.length ? notes.join("; ") : null,
      });
      prevEnding = endingOccupied;
    }

    communities.push({
      sourceName: block.name,
      normalizedName: normalizeCommunityName(block.name),
      days,
      firstDate: days[0]?.date ?? null,
      lastDate: days[days.length - 1]?.date ?? null,
      futureRowsSkipped: blockFuture,
    });
  }

  if (unparsedDateColumns > 0) {
    warnings.push(`${unparsedDateColumns} column(s) in the date header row could not be read as dates`);
  }
  if (futureRowsSkipped > 0) {
    warnings.push(`${futureRowsSkipped} day value(s) on or after ${cutoff} were skipped`);
  }

  const allDates = communities.flatMap((c) => c.days.map((d) => d.date)).sort();
  const yearMatch = /(20\d{2})/.exec(fileName);

  return {
    sheetName,
    fileName,
    columns: dateCols.length,
    rangeStart: allDates[0] ?? null,
    rangeEnd: allDates[allDates.length - 1] ?? null,
    year: yearMatch ? Number(yearMatch[1]) : allDates[0] ? Number(allDates[0].slice(0, 4)) : null,
    communities,
    rollupRowsSkipped,
    futureRowsSkipped,
    unparsedDateColumns,
    warnings,
  };
}
