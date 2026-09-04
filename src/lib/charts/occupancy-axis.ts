/**
 * Shared dynamic Y-axis calculation for occupancy trend charts.
 *
 * Visualization only: this never changes any occupancy value, it only chooses
 * how much of the numeric space the chart shows. Occupancy sits in a narrow
 * band near the top of its possible range, so anchoring every axis at zero
 * wastes the plot area. The range is computed from the values that are
 * actually visible (every enabled series, budget included), padded so small
 * movement never looks extreme, and rounded to clean tick values.
 *
 * Percentage and count series must never share one axis: pass the right kind
 * and keep incompatible units in separate charts or behind a % | Units toggle.
 */
export type OccupancyAxis = { domain: [number, number]; ticks: number[] };

export function occupancyAxis(
  values: (number | null | undefined)[],
  kind: "percent" | "count",
): OccupancyAxis {
  const percent = kind === "percent";
  const finite = values.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number);
  if (finite.length === 0) return { domain: [0, percent ? 100 : 10], ticks: [] };

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  const spread = max - min;
  // Minimum padding keeps a flat or single-point series from filling the frame.
  const pad = Math.max(spread * 0.15, percent ? 1 : 1);
  min -= pad;
  max += pad;
  min = Math.max(0, min);
  if (percent) max = Math.min(100, max);

  const raw = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  lo = Math.max(0, lo);
  if (percent) hi = Math.min(100, hi);

  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(4)));
  return { domain: [lo, hi], ticks };
}

/** Collect the values of the enabled series keys from chart rows. */
export function visibleValues(rows: Record<string, any>[], keys: string[]): number[] {
  return rows.flatMap((r) => keys.map((k) => Number(r[k]))).filter((v) => Number.isFinite(v));
}
