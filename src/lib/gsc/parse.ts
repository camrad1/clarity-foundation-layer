import JSZip from "jszip";
import * as XLSX from "xlsx";
import { hashFile, normalizeQuery, normalizeUrl } from "./normalize";

/**
 * Google Search Console export parser.
 *
 * A standard export contains one file (CSV) or sheet (XLSX) per report grain.
 * Each grain is parsed independently and NEVER merged with another grain:
 * the Queries report and the Pages report are separate datasets and cannot be
 * joined into query x page combinations.
 *
 * Nothing is imported unless the structure validates.
 */

export type GrainKey =
  | "daily"
  | "query"
  | "page"
  | "device"
  | "country"
  | "search_appearance";

export const GRAIN_LABELS: Record<GrainKey, string> = {
  daily: "Dates",
  query: "Queries",
  page: "Pages",
  device: "Devices",
  country: "Countries",
  search_appearance: "Search appearance",
};

export type MetricRow = {
  /** Dimension value as exported (date string for the daily grain). */
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export type ParsedGrain = {
  grain: GrainKey;
  sourceFile: string;
  rows: MetricRow[];
  warnings: string[];
};

export type ParsedFile = {
  fileName: string;
  fileHash: string;
  sizeBytes: number;
  grains: ParsedGrain[];
  warnings: string[];
  errors: string[];
  dataStartDate: string | null;
  dataEndDate: string | null;
};

/**
 * Maps an export file/sheet name onto a grain. Unknown names are ignored.
 *
 * Google's Performance export names the daily time series "Chart.csv" (the
 * chart drawn above the table), not "Dates.csv", so both map to the canonical
 * daily grain. "Filters.csv" carries no metrics and stays unrecognised.
 */
export function detectGrain(name: string): GrainKey | null {
  const n = name.toLowerCase().replace(/\.(csv|tsv|xlsx)$/, "").trim();
  if (/^dates?$/.test(n) || n.includes("date")) return "daily";
  if (n.includes("chart")) return "daily";
  if (n.includes("quer")) return "query";
  if (n.includes("page")) return "page";
  if (n.includes("device")) return "device";
  if (n.includes("countr")) return "country";
  if (n.includes("appearance")) return "search_appearance";
  return null;
}


const DIMENSION_HEADERS: Record<GrainKey, RegExp> = {
  daily: /^date$/i,
  query: /^(top )?quer(y|ies)$/i,
  page: /^(top )?pages?$/i,
  device: /^device$/i,
  country: /^countr(y|ies)$/i,
  search_appearance: /^search appearance$/i,
};

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value ?? "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** CTR arrives as "3.45%" (or 0.0345 in XLSX). Always stored as a fraction. */
function parseCtr(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value > 1 ? value / 100 : value;
  const s = String(value).trim();
  const n = Number(s.replace(/[%,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return s.includes("%") || n > 1 ? n / 100 : n;
}

function parsePosition(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = num(value);
  return n > 0 ? n : null;
}

/**
 * Dates arrive as ISO strings, as real Date cells, or — when a spreadsheet
 * engine has already coerced the column — as an Excel serial number. All three
 * are read as the exported calendar day, never shifted by a timezone.
 */
function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    const utc = new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
    return utc.toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Excel serial day (1900 date system); the plausible window keeps this from
  // swallowing years or other stray numbers.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 80000) {
      const ms = Math.round((serial - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

type Sheet = { name: string; rows: Record<string, unknown>[] };

function sheetsFromWorkbook(wb: XLSX.WorkBook, fallbackName: string): Sheet[] {
  return wb.SheetNames.map((name) => ({
    name: wb.SheetNames.length === 1 ? fallbackName || name : name,
    rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]!, { defval: "" }),
  }));
}

function headerFor(row: Record<string, unknown>, pattern: RegExp): string | null {
  return Object.keys(row).find((k) => pattern.test(k.trim())) ?? null;
}

function metricHeader(row: Record<string, unknown>, pattern: RegExp): string | null {
  return Object.keys(row).find((k) => pattern.test(k.trim())) ?? null;
}

function parseSheet(sheet: Sheet, grain: GrainKey): ParsedGrain | { error: string } {
  const warnings: string[] = [];
  if (!sheet.rows.length) return { error: `${sheet.name}: report is empty.` };
  const first = sheet.rows[0]!;
  const dim = headerFor(first, DIMENSION_HEADERS[grain]);
  const clicksKey = metricHeader(first, /^clicks$/i);
  const imprKey = metricHeader(first, /^impressions$/i);
  if (!dim) return { error: `${sheet.name}: missing the expected dimension column.` };
  if (!clicksKey || !imprKey)
    return { error: `${sheet.name}: missing Clicks or Impressions columns.` };
  const ctrKey = metricHeader(first, /^ctr$/i);
  const posKey = metricHeader(first, /position/i);
  if (!ctrKey) warnings.push(`${sheet.name}: no CTR column — CTR is recalculated from totals.`);
  if (!posKey) warnings.push(`${sheet.name}: no Position column — average position unavailable.`);

  const rows: MetricRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of sheet.rows) {
    let key = String(raw[dim] ?? "").trim();
    if (!key) {
      skipped += 1;
      continue;
    }
    if (grain === "daily") {
      const d = parseDate(raw[dim]);
      if (!d) {
        skipped += 1;
        continue;
      }
      key = d;
    }
    const dedupeKey =
      grain === "query" ? normalizeQuery(key) : grain === "page" ? normalizeUrl(key) : key;
    if (seen.has(dedupeKey)) {
      skipped += 1;
      continue;
    }
    seen.add(dedupeKey);
    rows.push({
      key,
      clicks: Math.round(num(raw[clicksKey])),
      impressions: Math.round(num(raw[imprKey])),
      ctr: ctrKey ? parseCtr(raw[ctrKey]) : null,
      position: posKey ? parsePosition(raw[posKey]) : null,
    });
  }
  if (!rows.length) return { error: `${sheet.name}: no usable rows found.` };
  if (skipped) warnings.push(`${sheet.name}: ${skipped} row(s) skipped (blank or duplicate).`);
  return { grain, sourceFile: sheet.name, rows, warnings };
}

async function sheetsFromEntry(name: string, data: ArrayBuffer): Promise<Sheet[]> {
  if (/\.(csv|tsv|txt)$/i.test(name)) {
    const text = new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, "");
    const wb = XLSX.read(text, { type: "string", raw: false, cellDates: true });
    return sheetsFromWorkbook(wb, name);
  }
  const wb = XLSX.read(new Uint8Array(data), { type: "array", cellDates: true });
  return sheetsFromWorkbook(wb, "");
}

/**
 * Parses a ZIP, XLSX or single CSV Search Console export. Report types that
 * are not present are simply absent from the result — never assumed.
 */
export async function parseGscFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const fileHash = await hashFile(buffer);
  const result: ParsedFile = {
    fileName: file.name,
    fileHash,
    sizeBytes: file.size,
    grains: [],
    warnings: [],
    errors: [],
    dataStartDate: null,
    dataEndDate: null,
  };

  let sheets: Sheet[] = [];
  try {
    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(buffer);
      const entries = Object.values(zip.files).filter(
        (e) => !e.dir && /\.(csv|tsv|xlsx)$/i.test(e.name),
      );
      if (!entries.length) result.errors.push("The ZIP archive contains no CSV or XLSX reports.");
      for (const entry of entries) {
        const data = await entry.async("arraybuffer");
        const base = entry.name.split("/").pop() ?? entry.name;
        sheets.push(...(await sheetsFromEntry(base, data)));
      }
    } else if (/\.(csv|tsv|txt|xlsx|xls)$/i.test(file.name)) {
      sheets = await sheetsFromEntry(file.name, buffer);
    } else {
      result.errors.push("Unsupported file type. Upload a ZIP, XLSX or CSV export.");
    }
  } catch (e) {
    result.errors.push(`Could not read the file: ${(e as Error).message}`);
    return result;
  }

  for (const sheet of sheets) {
    const grain = detectGrain(sheet.name);
    if (!grain) {
      result.warnings.push(`Ignored "${sheet.name}" — not a recognised Search Console report.`);
      continue;
    }
    if (result.grains.some((g) => g.grain === grain)) {
      result.warnings.push(`Ignored duplicate ${GRAIN_LABELS[grain]} report "${sheet.name}".`);
      continue;
    }
    const parsed = parseSheet(sheet, grain);
    if ("error" in parsed) {
      result.errors.push(parsed.error);
      continue;
    }
    result.grains.push(parsed);
    result.warnings.push(...parsed.warnings);
  }

  if (!result.grains.length && !result.errors.length)
    result.errors.push("No recognised Search Console reports were found in this file.");

  const daily = result.grains.find((g) => g.grain === "daily");
  if (daily) {
    const dates = daily.rows.map((r) => r.key).sort();
    result.dataStartDate = dates[0] ?? null;
    result.dataEndDate = dates[dates.length - 1] ?? null;
  }
  return result;
}

/** Totals for a grain — CTR is always clicks / impressions, never averaged. */
export function grainTotals(rows: MetricRow[]) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const weighted = rows.reduce((s, r) => s + (r.position ?? 0) * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? weighted / impressions : null,
  };
}
