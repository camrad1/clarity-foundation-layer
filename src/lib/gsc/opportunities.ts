/**
 * Central, deterministic SEO opportunity definitions.
 *
 * These rules are defined ONCE here so every table, card and count in Search
 * Intelligence uses identical logic. Do not re-implement thresholds inside
 * components. None of these rules is an industry guarantee — they are
 * heuristics for prioritising review, and the UI labels them as such.
 */

export type PositionBucket = "1-3" | "4-10" | "11-20" | "21+";

export const POSITION_BUCKETS: PositionBucket[] = ["1-3", "4-10", "11-20", "21+"];

export function positionBucket(position: number | null): PositionBucket | null {
  if (position === null || !Number.isFinite(position)) return null;
  if (position <= 3) return "1-3";
  if (position <= 10) return "4-10";
  if (position <= 20) return "11-20";
  return "21+";
}

export type OpportunityThresholds = {
  /** Striking distance: position strictly greater than this. */
  strikingMinPosition: number;
  /** Striking distance: position less than or equal to this. */
  strikingMaxPosition: number;
  /** Minimum impressions for any opportunity to be considered meaningful. */
  minImpressions: number;
  /**
   * Low-CTR rule: a row underperforms when its CTR is below this share of the
   * benchmark CTR for other rows in the same position bucket.
   */
  lowCtrRatio: number;
};

export const DEFAULT_THRESHOLDS: OpportunityThresholds = {
  strikingMinPosition: 10,
  strikingMaxPosition: 20,
  minImpressions: 100,
  lowCtrRatio: 0.5,
};

export const OPPORTUNITY_METHODOLOGY = {
  striking:
    "Average position above 10 and up to 20, with at least the configured minimum impressions. Ranking on page two where small gains can reach page one.",
  page1:
    "Average position between 4 and 10 — already on page one but below the top three.",
  lowCtr:
    "Click-through rate materially below the benchmark for other rows in the same position bucket, at meaningful impression volume. Relative, not a single fixed CTR threshold.",
} as const;

export type MetricLike = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export function isStrikingDistance(row: MetricLike, t = DEFAULT_THRESHOLDS): boolean {
  return (
    row.position !== null &&
    row.position > t.strikingMinPosition &&
    row.position <= t.strikingMaxPosition &&
    row.impressions >= t.minImpressions
  );
}

export function isPageOneBelowTop3(row: MetricLike, t = DEFAULT_THRESHOLDS): boolean {
  return (
    row.position !== null &&
    row.position >= 4 &&
    row.position <= 10 &&
    row.impressions >= t.minImpressions
  );
}

/** Effective CTR — recomputed from clicks/impressions, never an averaged column. */
export function effectiveCtr(row: MetricLike): number | null {
  return row.impressions > 0 ? row.clicks / row.impressions : null;
}

/**
 * Impression-weighted benchmark CTR per position bucket for the supplied
 * dataset. Comparison happens within a bucket so position context is respected.
 */
export function ctrBenchmarks(rows: MetricLike[]): Record<PositionBucket, number | null> {
  const acc: Record<string, { clicks: number; impressions: number }> = {};
  for (const r of rows) {
    const b = positionBucket(r.position);
    if (!b) continue;
    acc[b] ??= { clicks: 0, impressions: 0 };
    acc[b]!.clicks += r.clicks;
    acc[b]!.impressions += r.impressions;
  }
  const out = {} as Record<PositionBucket, number | null>;
  for (const b of POSITION_BUCKETS) {
    const a = acc[b];
    out[b] = a && a.impressions > 0 ? a.clicks / a.impressions : null;
  }
  return out;
}

export function isLowCtrOpportunity(
  row: MetricLike,
  benchmarks: Record<PositionBucket, number | null>,
  t = DEFAULT_THRESHOLDS,
): boolean {
  const bucket = positionBucket(row.position);
  const ctr = effectiveCtr(row);
  if (!bucket || ctr === null) return false;
  const benchmark = benchmarks[bucket];
  if (benchmark === null || benchmark <= 0) return false;
  return row.impressions >= t.minImpressions && ctr < benchmark * t.lowCtrRatio;
}

export type OpportunityFlag = "striking" | "page1" | "low_ctr";

export const OPPORTUNITY_LABELS: Record<OpportunityFlag, string> = {
  striking: "Striking distance",
  page1: "Position 4–10",
  low_ctr: "Low CTR for position",
};

export function opportunityFlags(
  row: MetricLike,
  benchmarks: Record<PositionBucket, number | null>,
  t = DEFAULT_THRESHOLDS,
): OpportunityFlag[] {
  const flags: OpportunityFlag[] = [];
  if (isStrikingDistance(row, t)) flags.push("striking");
  if (isPageOneBelowTop3(row, t)) flags.push("page1");
  if (isLowCtrOpportunity(row, benchmarks, t)) flags.push("low_ctr");
  return flags;
}
