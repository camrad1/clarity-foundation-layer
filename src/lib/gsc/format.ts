/** Presentation helpers — no business logic lives here. */

export const nf = new Intl.NumberFormat("en-US");

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : nf.format(Math.round(n));
}

export function fmtPercent(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export function fmtPosition(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(1);
}

export function fmtDelta(value: number | null, opts?: { invert?: boolean }) {
  if (value === null) return { label: "—", tone: "neutral" as const };
  const improving = opts?.invert ? value < 0 : value > 0;
  const tone = value === 0 ? ("neutral" as const) : improving ? ("up" as const) : ("down" as const);
  const sign = value > 0 ? "+" : "";
  return { label: `${sign}${(value * 100).toFixed(1)}%`, tone };
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
