/**
 * WelcomeHome source table registry (client-safe constants).
 *
 * ClarityIQ treats WelcomeHome as a READ-ONLY system of record. Nothing in
 * Phase 2 writes back to the CRM: no record edits, no activities, no stage
 * changes, no notes. Every table below is pulled through the bulk export API
 * and stored as an analytics copy.
 */

export const WH_API_BASE = "https://crm.welcomehomesoftware.com/api";

/** Core datasets that carry facts. Failure of any of these fails the sync. */
export const WH_CORE_TABLES = [
  "Prospects",
  "Activities",
  "HousingContracts",
  "Units",
  "MarketingTouchpoints",
  "DepositTransactions",
] as const;

/**
 * Lookup dimensions. Missing lookups degrade mapping, not fact ingestion.
 *
 * IMPORTANT (verified against the live API on 2026-09-02): lookups are NOT
 * bulk-export tables. `/exports/community/{id}/table/{Lookup}` returns 404 with
 * `Invalid table, must be one of [...]`. Every lookup below is served by a
 * dedicated top-level JSON endpoint instead, except Referrers, which IS a valid
 * export table (and whose dedicated `/referrers` endpoint returns 401 for this
 * token scope).
 */
export const WH_LOOKUP_TABLES = [
  "LeadSources",
  "Stages",
  "Scores",
  "ActivityTypes",
  "ActivityResults",
  "CareTypes",
  "FloorPlans",
  "PrivacyLevels",
  "CloseReasons",
  "Referrers",
  "Traits",
  "Users",
] as const;

export type WhCoreTable = (typeof WH_CORE_TABLES)[number];
export type WhLookupTable = (typeof WH_LOOKUP_TABLES)[number];
export type WhTable = WhCoreTable | WhLookupTable;

/**
 * How each lookup is actually retrieved.
 * - `json`  → GET /api/{path}, returns a JSON array (account-wide, not per community)
 * - `export`→ GET /api/exports/community/{id}/table/{path}, returns CSV
 */
export const WH_LOOKUP_SOURCE: Record<
  WhLookupTable,
  { kind: "json" | "export"; path: string }
> = {
  LeadSources: { kind: "json", path: "lead_sources" },
  Stages: { kind: "json", path: "stages" },
  Scores: { kind: "json", path: "scores" },
  ActivityTypes: { kind: "json", path: "activity_types" },
  ActivityResults: { kind: "json", path: "activity_results" },
  CareTypes: { kind: "json", path: "care_types" },
  FloorPlans: { kind: "json", path: "floor_plans" },
  PrivacyLevels: { kind: "json", path: "privacy_levels" },
  CloseReasons: { kind: "json", path: "close_reasons" },
  Traits: { kind: "json", path: "traits" },
  Users: { kind: "json", path: "users" },
  Referrers: { kind: "export", path: "Referrers" },
};

/**
 * Referrers rows are person records. Only these non-identifying fields are
 * retained; names, emails, phones, addresses and free-text stories are dropped
 * before anything is stored.
 */
export const WH_REFERRER_SAFE_FIELDS = [
  "referrers_id",
  "referrers_status",
  "referrers_created_at",
  "referrers_active_at",
  "referrers_discarded_at",
  "referrers_organization_id",
  "scores_name",
  "communities_id",
  "communities_name",
] as const;

export const WH_ALL_TABLES: WhTable[] = [...WH_LOOKUP_TABLES, ...WH_CORE_TABLES];


/** Normalized destination table for each core dataset. */
export const WH_CORE_DESTINATION: Record<WhCoreTable, string> = {
  Prospects: "wh_prospects",
  Activities: "wh_activities",
  HousingContracts: "wh_housing_contracts",
  Units: "wh_units",
  MarketingTouchpoints: "wh_marketing_touchpoints",
  DepositTransactions: "wh_deposit_transactions",
};

/** Lookup type key stored in wh_lookups.lookup_type. */
export const WH_LOOKUP_KEY: Record<WhLookupTable, string> = {
  LeadSources: "lead_source",
  Stages: "stage",
  Scores: "score",
  ActivityTypes: "activity_type",
  ActivityResults: "activity_result",
  CareTypes: "care_type",
  FloorPlans: "floor_plan",
  PrivacyLevels: "privacy_level",
  CloseReasons: "close_reason",
  Referrers: "referrer",
  Traits: "trait",
  Users: "user",
};

export const WH_ACTIVITY_CATEGORIES = [
  "tour",
  "re_tour",
  "call",
  "email",
  "outreach",
  "appointment",
  "other",
  "unmapped",
] as const;
export type WhActivityCategory = (typeof WH_ACTIVITY_CATEGORIES)[number];

export const WH_ACTIVITY_CATEGORY_LABELS: Record<WhActivityCategory, string> = {
  tour: "Tour",
  re_tour: "Re-Tour",
  call: "Call",
  email: "Email",
  outreach: "Outreach",
  appointment: "Appointment",
  other: "Other",
  unmapped: "Not mapped",
};

export const WH_SCORE_LEVELS = ["hot", "warm", "cold", "unknown"] as const;
export type WhScoreLevel = (typeof WH_SCORE_LEVELS)[number];

export const WH_SCORE_LEVEL_LABELS: Record<WhScoreLevel, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  unknown: "Unknown",
};

/** Maximum page size WelcomeHome allows on bulk exports. */
export const WH_MAX_PAGE_SIZE = 10000;
/** Default page size documented by WelcomeHome. */
export const WH_DEFAULT_PAGE_SIZE = 1000;

/**
 * Tables that support `filters[updated_at_after]`. Lookup dimensions are small
 * and are always refreshed in full so label changes are never missed.
 */
export const WH_INCREMENTAL_TABLES: WhTable[] = [...WH_CORE_TABLES];

export function isCoreTable(table: string): table is WhCoreTable {
  return (WH_CORE_TABLES as readonly string[]).includes(table);
}
