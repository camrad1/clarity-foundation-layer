/**
 * Deterministic Search Console insight engine.
 *
 * LAYERING RULE
 * -------------
 * measured data -> deterministic signal -> (optional) plain-English wording.
 *
 * Every number an insight shows is computed here, from imported Search Console
 * rows only. No model is involved at this layer, nothing is estimated, and no
 * causal claim is ever produced: an insight states what moved, never why. AI
 * wording (see explain.functions.ts) receives these finished numbers and may
 * only rephrase them.
 *
 * Search Console is aggregate data. Nothing here may be described as having
 * generated leads, tours or move-ins.
 */

import { differenceInCalendarDays, parseISO } from "date-fns";
import { classificationLabel } from "./classification";
import { fmtInt, fmtPercent, fmtPosition } from "./format";
import { pageLabel } from "./normalize";
import {
  DEFAULT_THRESHOLDS,
  ctrBenchmarks,
  effectiveCtr,
  isLowCtrOpportunity,
  positionBucket,
  type MetricLike,
} from "./opportunities";
import type { Period } from "./compare";

export type Priority = "high" | "medium" | "low";

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type InsightKind =
  | "gain"
  | "decline"
  | "opportunity"
  | "community"
  | "intent";

export type EvidenceItem = { label: string; value: string };

export type InsightLink = {
  label: string;
  to: string;
  search?: Record<string, string>;
};

export type Insight = {
  id: string;
  kind: InsightKind;
  priority: Priority;
  /** The subject: a query, a page or a community. */
  subject: string;
  /** One deterministic sentence describing the measured signal. */
  signal: string;
  /** Rule that produced this insight, shown so the reader can audit it. */
  rule: string;
  evidence: EvidenceItem[];
  link: InsightLink | null;
};

export type QueryRow = {
  query: string;
  normalized_query: string;
  classification: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position_value: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
  prev_ctr: number | null;
  prev_position_value: number | null;
};

export type PageRow = {
  page_url: string;
  normalized_url: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position_value: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
  prev_ctr: number | null;
  prev_position_value: number | null;
  mapped_community_id: string | null;
  community_name: string | null;
};

/* ------------------------------------------------------------------ */
/* Comparison validity                                                 */
/* ------------------------------------------------------------------ */

/**
 * Aggregate exports are fixed-period totals, so two exports may only be
 * compared when they cover a genuinely similar span. A calendar month against
 * the previous calendar month is valid; a month against a 16-month export is
 * not, and produces no comparison insights at all.
 */
export const COMPARISON_RULE =
  "Two Search Console exports are compared only when they cover a similar span (within 3 days or 10% of each other) and do not overlap.";

export function periodDays(p: Period): number {
  return differenceInCalendarDays(parseISO(p.end), parseISO(p.start)) + 1;
}

export function isComparablePeriod(current: Period | null, prior: Period | null): boolean {
  if (!current || !prior) return false;
  if (prior.end >= current.start) return false;
  const a = periodDays(current);
  const b = periodDays(prior);
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff <= 3 || diff / Math.max(a, b) <= 0.1;
}

/* ------------------------------------------------------------------ */
/* Priority rules (fixed thresholds, never model scored)               */
/* ------------------------------------------------------------------ */

const MOVEMENT_RULE =
  "Priority: High when clicks moved by 25 or more, or by 10 or more with at least 5,000 impressions. Medium at 10 or more clicks. Otherwise Low.";

function movementPriority(clickDelta: number, impressions: number): Priority {
  const magnitude = Math.abs(clickDelta);
  if (magnitude >= 25 || (magnitude >= 10 && impressions >= 5000)) return "high";
  if (magnitude >= 10) return "medium";
  return "low";
}

const VOLUME_RULE =
  "Priority: High at 5,000 or more impressions, Medium at 1,000 or more, otherwise Low.";

function volumePriority(impressions: number): Priority {
  if (impressions >= 5000) return "high";
  if (impressions >= 1000) return "medium";
  return "low";
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const pctChange = (current: number, prev: number): number | null =>
  prev > 0 ? (current - prev) / prev : null;

function deltaText(current: number, prev: number): string {
  const pct = pctChange(current, prev);
  const sign = current - prev > 0 ? "+" : "";
  const suffix = pct === null ? "" : ` (${sign}${(pct * 100).toFixed(0)}%)`;
  return `${fmtInt(prev)} → ${fmtInt(current)}${suffix}`;
}

function positionText(current: number | null, prev: number | null): string {
  if (current === null) return "—";
  if (prev === null) return fmtPosition(current);
  const move = prev - current; // positive = improved (closer to 1)
  const sign = move > 0 ? "improved by " : move < 0 ? "worsened by " : "";
  return `${fmtPosition(prev)} → ${fmtPosition(current)}${
    move === 0 ? "" : ` (${sign}${Math.abs(move).toFixed(1)})`
  }`;
}

const metricOf = (r: { clicks: number; impressions: number; ctr: number | null; position_value: number | null }): MetricLike => ({
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position_value,
});

const queryLink = (row: QueryRow): InsightLink => ({
  label: "View in Query Intelligence",
  to: "/marketing/queries",
  search: { q: row.normalized_query },
});

const pageLink = (row: PageRow): InsightLink => ({
  label: "View in Page Intelligence",
  to: "/marketing/pages",
  search: { url: row.normalized_url },
});

/* ------------------------------------------------------------------ */
/* Gains and declines (comparison dependent)                           */
/* ------------------------------------------------------------------ */

type Moved<T> = { row: T; clickDelta: number; imprDelta: number; posMove: number | null };

function movements<T extends { clicks: number; impressions: number; position_value: number | null; prev_clicks: number | null; prev_impressions: number | null; prev_position_value: number | null }>(
  rows: T[],
): Moved<T>[] {
  return rows
    .filter((r) => r.prev_clicks !== null || r.prev_impressions !== null)
    .map((r) => ({
      row: r,
      clickDelta: r.clicks - (r.prev_clicks ?? 0),
      imprDelta: r.impressions - (r.prev_impressions ?? 0),
      posMove:
        r.position_value !== null && r.prev_position_value !== null
          ? r.prev_position_value - r.position_value
          : null,
    }));
}

export function queryGains(rows: QueryRow[], limit = 5): Insight[] {
  return movements(rows)
    .filter((m) => m.clickDelta > 0)
    .sort((a, b) => b.clickDelta - a.clickDelta)
    .slice(0, limit)
    .map((m) => ({
      id: `gain-query-${m.row.normalized_query}`,
      kind: "gain" as const,
      priority: movementPriority(m.clickDelta, m.row.impressions),
      subject: m.row.query,
      signal: `Clicks increased by ${fmtInt(m.clickDelta)} compared with the prior export.`,
      rule: `Largest click increase between the two comparable exports. ${MOVEMENT_RULE}`,
      evidence: [
        { label: "Clicks", value: deltaText(m.row.clicks, m.row.prev_clicks ?? 0) },
        { label: "Impressions", value: deltaText(m.row.impressions, m.row.prev_impressions ?? 0) },
        { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(m.row))) },
        { label: "Avg position", value: positionText(m.row.position_value, m.row.prev_position_value) },
      ],
      link: queryLink(m.row),
    }));
}

export function queryDeclines(rows: QueryRow[], limit = 5): Insight[] {
  return movements(rows)
    .filter((m) => m.clickDelta < 0)
    .sort((a, b) => a.clickDelta - b.clickDelta)
    .slice(0, limit)
    .map((m) => ({
      id: `decline-query-${m.row.normalized_query}`,
      kind: "decline" as const,
      priority: movementPriority(m.clickDelta, m.row.prev_impressions ?? m.row.impressions),
      subject: m.row.query,
      signal: `Clicks decreased by ${fmtInt(Math.abs(m.clickDelta))} compared with the prior export.`,
      rule: `Largest click decrease between the two comparable exports. ${MOVEMENT_RULE}`,
      evidence: [
        { label: "Clicks", value: deltaText(m.row.clicks, m.row.prev_clicks ?? 0) },
        { label: "Impressions", value: deltaText(m.row.impressions, m.row.prev_impressions ?? 0) },
        { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(m.row))) },
        { label: "Avg position", value: positionText(m.row.position_value, m.row.prev_position_value) },
      ],
      link: queryLink(m.row),
    }));
}

export function pageDeclines(rows: PageRow[], limit = 5): Insight[] {
  return movements(rows)
    .filter((m) => m.clickDelta < 0)
    .sort((a, b) => a.clickDelta - b.clickDelta)
    .slice(0, limit)
    .map((m) => ({
      id: `decline-page-${m.row.normalized_url}`,
      kind: "decline" as const,
      priority: movementPriority(m.clickDelta, m.row.prev_impressions ?? m.row.impressions),
      subject: pageLabel(m.row.page_url),
      signal: `Clicks to this page decreased by ${fmtInt(Math.abs(m.clickDelta))} compared with the prior export.`,
      rule: `Largest click decrease among pages between the two comparable exports. ${MOVEMENT_RULE}`,
      evidence: [
        { label: "Community", value: m.row.community_name ?? "Unmapped" },
        { label: "Clicks", value: deltaText(m.row.clicks, m.row.prev_clicks ?? 0) },
        { label: "Impressions", value: deltaText(m.row.impressions, m.row.prev_impressions ?? 0) },
        { label: "Avg position", value: positionText(m.row.position_value, m.row.prev_position_value) },
      ],
      link: pageLink(m.row),
    }));
}

export function pageGains(rows: PageRow[], limit = 5): Insight[] {
  return movements(rows)
    .filter((m) => m.clickDelta > 0)
    .sort((a, b) => b.clickDelta - a.clickDelta)
    .slice(0, limit)
    .map((m) => ({
      id: `gain-page-${m.row.normalized_url}`,
      kind: "gain" as const,
      priority: movementPriority(m.clickDelta, m.row.impressions),
      subject: pageLabel(m.row.page_url),
      signal: `Clicks to this page increased by ${fmtInt(m.clickDelta)} compared with the prior export.`,
      rule: `Largest click increase among pages between the two comparable exports. ${MOVEMENT_RULE}`,
      evidence: [
        { label: "Community", value: m.row.community_name ?? "Unmapped" },
        { label: "Clicks", value: deltaText(m.row.clicks, m.row.prev_clicks ?? 0) },
        { label: "Impressions", value: deltaText(m.row.impressions, m.row.prev_impressions ?? 0) },
        { label: "Avg position", value: positionText(m.row.position_value, m.row.prev_position_value) },
      ],
      link: pageLink(m.row),
    }));
}

/* ------------------------------------------------------------------ */
/* Opportunities (single-period, no comparison required)               */
/* ------------------------------------------------------------------ */

/** Queries sitting roughly on page two: position 8–20 with real impressions. */
export function nearPageOne(rows: QueryRow[], limit = 5): Insight[] {
  const min = DEFAULT_THRESHOLDS.minImpressions;
  return rows
    .filter(
      (r) =>
        r.position_value !== null &&
        r.position_value >= 8 &&
        r.position_value <= 20 &&
        r.impressions >= min,
    )
    .map((r) => ({
      r,
      // Opportunity score: impressions weighted by how close the query already
      // is to page one. Deterministic, no model input.
      score: r.impressions * ((21 - (r.position_value as number)) / 13),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({
      id: `near-page-one-${r.normalized_query}`,
      kind: "opportunity" as const,
      priority: volumePriority(r.impressions),
      subject: r.query,
      signal: `Ranking at position ${fmtPosition(r.position_value)} with ${fmtInt(r.impressions)} impressions — close to page one.`,
      rule: `Average position between 8 and 20 with at least ${fmtInt(min)} impressions, ranked by impressions weighted toward better positions. ${VOLUME_RULE}`,
      evidence: [
        { label: "Avg position", value: fmtPosition(r.position_value) },
        { label: "Impressions", value: fmtInt(r.impressions) },
        { label: "Clicks", value: fmtInt(r.clicks) },
        { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(r))) },
      ],
      link: queryLink(r),
    }));
}

/** Rows whose CTR is far below the benchmark for their own position bucket. */
export function ctrOpportunities(
  queries: QueryRow[],
  pages: PageRow[],
  limit = 5,
): Insight[] {
  const qBench = ctrBenchmarks(queries.map(metricOf));
  const pBench = ctrBenchmarks(pages.map(metricOf));

  const fromQueries = queries
    .filter((r) => isLowCtrOpportunity(metricOf(r), qBench))
    .map((r) => {
      const bucket = positionBucket(r.position_value);
      const benchmark = bucket ? qBench[bucket] : null;
      return {
        insight: {
          id: `ctr-query-${r.normalized_query}`,
          kind: "opportunity" as const,
          priority: volumePriority(r.impressions),
          subject: r.query,
          signal: `Click-through rate is below the benchmark for queries in position band ${bucket}.`,
          rule: `CTR under ${Math.round(DEFAULT_THRESHOLDS.lowCtrRatio * 100)}% of the impression-weighted benchmark for the same position band, at ${fmtInt(DEFAULT_THRESHOLDS.minImpressions)}+ impressions. ${VOLUME_RULE}`,
          evidence: [
            { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(r))) },
            { label: `Benchmark CTR (${bucket})`, value: fmtPercent(benchmark) },
            { label: "Impressions", value: fmtInt(r.impressions) },
            { label: "Avg position", value: fmtPosition(r.position_value) },
          ],
          link: queryLink(r),
        } satisfies Insight,
        impressions: r.impressions,
      };
    });

  const fromPages = pages
    .filter((r) => isLowCtrOpportunity(metricOf(r), pBench))
    .map((r) => {
      const bucket = positionBucket(r.position_value);
      const benchmark = bucket ? pBench[bucket] : null;
      return {
        insight: {
          id: `ctr-page-${r.normalized_url}`,
          kind: "opportunity" as const,
          priority: volumePriority(r.impressions),
          subject: pageLabel(r.page_url),
          signal: `This page earns fewer clicks than other pages ranking in position band ${bucket}.`,
          rule: `CTR under ${Math.round(DEFAULT_THRESHOLDS.lowCtrRatio * 100)}% of the impression-weighted benchmark for the same position band, at ${fmtInt(DEFAULT_THRESHOLDS.minImpressions)}+ impressions. ${VOLUME_RULE}`,
          evidence: [
            { label: "Community", value: r.community_name ?? "Unmapped" },
            { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(r))) },
            { label: `Benchmark CTR (${bucket})`, value: fmtPercent(benchmark) },
            { label: "Impressions", value: fmtInt(r.impressions) },
          ],
          link: pageLink(r),
        } satisfies Insight,
        impressions: r.impressions,
      };
    });

  return [...fromQueries, ...fromPages]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map((x) => x.insight);
}

/** Pages with impressions but very few clicks, ranked by unrealised volume. */
export function pageOpportunities(pages: PageRow[], limit = 5): Insight[] {
  const bench = ctrBenchmarks(pages.map(metricOf));
  return pages
    .filter((r) => r.impressions >= DEFAULT_THRESHOLDS.minImpressions)
    .map((r) => {
      const bucket = positionBucket(r.position_value);
      const benchmark = bucket ? bench[bucket] : null;
      const ctr = effectiveCtr(metricOf(r)) ?? 0;
      const gap = benchmark && benchmark > ctr ? (benchmark - ctr) * r.impressions : 0;
      return { r, gap, benchmark, bucket };
    })
    .filter((x) => x.gap >= 5)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit)
    .map(({ r, gap, benchmark, bucket }) => ({
      id: `page-opportunity-${r.normalized_url}`,
      kind: "opportunity" as const,
      priority: volumePriority(r.impressions),
      subject: pageLabel(r.page_url),
      signal: `At the benchmark click-through rate for position band ${bucket}, this page's current impressions would be associated with about ${fmtInt(gap)} additional clicks.`,
      rule: `Impressions multiplied by the gap between this page's CTR and the impression-weighted benchmark for its position band. Arithmetic on measured values only. ${VOLUME_RULE}`,
      evidence: [
        { label: "Community", value: r.community_name ?? "Unmapped" },
        { label: "Impressions", value: fmtInt(r.impressions) },
        { label: "Clicks", value: fmtInt(r.clicks) },
        { label: "CTR", value: fmtPercent(effectiveCtr(metricOf(r))) },
        { label: `Benchmark CTR (${bucket})`, value: fmtPercent(benchmark) },
      ],
      link: pageLink(r),
    }));
}

/* ------------------------------------------------------------------ */
/* Community movers (URL mapping only)                                 */
/* ------------------------------------------------------------------ */

export type CommunityTotals = {
  id: string;
  name: string;
  clicks: number;
  impressions: number;
  prevClicks: number;
  prevImpressions: number;
  pages: number;
};

export function communityTotals(pages: PageRow[]): CommunityTotals[] {
  const map = new Map<string, CommunityTotals>();
  for (const r of pages) {
    // Only deterministic URL mappings count. Unmapped pages are never
    // attributed to a community.
    if (!r.mapped_community_id) continue;
    const e =
      map.get(r.mapped_community_id) ??
      {
        id: r.mapped_community_id,
        name: r.community_name ?? "Unnamed community",
        clicks: 0,
        impressions: 0,
        prevClicks: 0,
        prevImpressions: 0,
        pages: 0,
      };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    e.prevClicks += r.prev_clicks ?? 0;
    e.prevImpressions += r.prev_impressions ?? 0;
    e.pages += 1;
    map.set(r.mapped_community_id, e);
  }
  return [...map.values()];
}

export function communityMovers(pages: PageRow[], limit = 5): Insight[] {
  return communityTotals(pages)
    .map((c) => ({ c, delta: c.clicks - c.prevClicks }))
    .filter((x) => x.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
    .map(({ c, delta }) => ({
      id: `community-${c.id}`,
      kind: "community" as const,
      priority: movementPriority(delta, c.impressions),
      subject: c.name,
      signal:
        delta > 0
          ? `Organic visibility increased across ${fmtInt(c.pages)} mapped page(s).`
          : `Organic visibility decreased across ${fmtInt(c.pages)} mapped page(s).`,
      rule: `Sum of clicks and impressions for pages matched to this community by URL mapping rules only. ${MOVEMENT_RULE}`,
      evidence: [
        { label: "Clicks", value: deltaText(c.clicks, c.prevClicks) },
        { label: "Impressions", value: deltaText(c.impressions, c.prevImpressions) },
        { label: "Mapped pages", value: fmtInt(c.pages) },
        {
          label: "CTR",
          value: fmtPercent(c.impressions ? c.clicks / c.impressions : null),
        },
      ],
      link: {
        label: "View in Page Intelligence",
        to: "/marketing/pages",
        search: { view: "communities" },
      },
    }));
}

/* ------------------------------------------------------------------ */
/* Intent mix                                                          */
/* ------------------------------------------------------------------ */

export type IntentRow = {
  key: string;
  label: string;
  clicks: number;
  prevClicks: number;
  impressions: number;
  prevImpressions: number;
  share: number | null;
  prevShare: number | null;
};

export function intentMix(queries: QueryRow[], comparable: boolean): IntentRow[] {
  const map = new Map<string, IntentRow>();
  for (const r of queries) {
    const key = r.classification ?? "unclassified";
    const e =
      map.get(key) ??
      {
        key,
        label: classificationLabel(r.classification),
        clicks: 0,
        prevClicks: 0,
        impressions: 0,
        prevImpressions: 0,
        share: null,
        prevShare: null,
      };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    e.prevClicks += r.prev_clicks ?? 0;
    e.prevImpressions += r.prev_impressions ?? 0;
    map.set(key, e);
  }
  const rows = [...map.values()];
  const total = rows.reduce((s, r) => s + r.clicks, 0);
  const prevTotal = rows.reduce((s, r) => s + r.prevClicks, 0);
  for (const r of rows) {
    r.share = total ? r.clicks / total : null;
    r.prevShare = comparable && prevTotal ? r.prevClicks / prevTotal : null;
  }
  return rows.sort((a, b) => b.clicks - a.clicks);
}

/* ------------------------------------------------------------------ */
/* Executive summary                                                   */
/* ------------------------------------------------------------------ */

export type Totals = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export function totalsOf(
  rows: { clicks: number; impressions: number; position_value: number | null }[],
): Totals {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const weighted = rows.reduce((s, r) => s + (r.position_value ?? 0) * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions ? weighted / impressions : null,
  };
}

export function priorTotalsOf(
  rows: { prev_clicks: number | null; prev_impressions: number | null; prev_position_value: number | null }[],
): Totals {
  const clicks = rows.reduce((s, r) => s + (r.prev_clicks ?? 0), 0);
  const impressions = rows.reduce((s, r) => s + (r.prev_impressions ?? 0), 0);
  const weighted = rows.reduce(
    (s, r) => s + (r.prev_position_value ?? 0) * (r.prev_impressions ?? 0),
    0,
  );
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions ? weighted / impressions : null,
  };
}

export function sortByPriority(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
