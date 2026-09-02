/**
 * WelcomeHome candidate metric vocabulary.
 *
 * The calculations themselves live in the database (public.wh_sales_summary),
 * so a KPI is always computed over the complete normalized dataset rather than
 * whatever subset a browser response happened to contain. This module keeps
 * only the shared types and the configuration vocabulary the admin screens and
 * dashboards present.
 *
 * Nothing here is AI-derived or estimated. Metrics whose official WelcomeHome
 * definition is still unresolved are withheld rather than guessed — see the
 * validation queue (V-001 … V-007) in the Reconciliation workspace.
 */

import type { WhActivityCategory, WhScoreLevel } from "./tables";

export type CandidateValue =
  | { resolved: true; value: number; ids: string[]; note: string }
  | { resolved: false; reason: string };

export type CommunityTz = Record<string, string | null>;

export type ActivityCategoryMap = Record<string, WhActivityCategory>;
export type ScoreLevelMap = Record<string, WhScoreLevel>;

export function buildActivityCategoryMap(
  rows: { activity_type_id: string; category: string }[],
): ActivityCategoryMap {
  const map: ActivityCategoryMap = {};
  for (const r of rows) map[r.activity_type_id] = r.category as WhActivityCategory;
  return map;
}

export function buildScoreLevelMap(rows: { score_id: string; level: string }[]): ScoreLevelMap {
  const map: ScoreLevelMap = {};
  for (const r of rows) map[r.score_id] = r.level as WhScoreLevel;
  return map;
}

// ---------------------------------------------------------------------------
// Provisional definition vocabulary (rendered in Admin → WelcomeHome settings)
// ---------------------------------------------------------------------------

export const INQUIRY_DATE_FIELDS = [
  { value: "created_at_source", label: "created_at (source record creation)" },
  { value: "initial_contact_at", label: "initial_contact_at" },
  { value: "active_at", label: "active_at" },
] as const;

export const MOVE_IN_DATE_FIELDS = [
  { value: "move_in_date", label: "move_in_date" },
  { value: "financial_move_in_date", label: "financial_move_in_date" },
] as const;

export const MOVE_OUT_DATE_FIELDS = [
  { value: "move_out_date", label: "move_out_date" },
  { value: "financial_move_out_date", label: "financial_move_out_date" },
] as const;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

/** Returns the Friday→Thursday week containing `today` (ISO yyyy-MM-dd). */
export function flashWeek(today = new Date()) {
  const d = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun … 5 Fri
  const daysSinceFriday = (dow - 5 + 7) % 7;
  const start = new Date(d.getTime() - daysSinceFriday * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
