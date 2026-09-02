/**
 * WelcomeHome record normalization — SERVER ONLY.
 *
 * COLUMN NAMING (root cause of the first real sync's 100% normalization failure)
 * -----------------------------------------------------------------------------
 * WelcomeHome bulk exports are JOINED CSVs. Every header is table-qualified:
 * `prospects.id`, `activities.completed_at`, `communities.id`, `stages.name`.
 * After header normalization those become `prospects_id`, `communities_id`, and
 * so on — so the previous lookups for a bare `id` / `community_id` always
 * returned null and every insert was rejected on a NOT NULL source_id.
 *
 * `aliasRecord()` therefore indexes each row twice: once under the literal
 * qualified key, and once under the bare column name for the row's OWN table
 * (`prospects.id` → `id` while parsing Prospects). Joined tables keep their
 * qualified keys, so `stages.name` never shadows `prospects.name`.
 *
 * DATE DERIVATION (documented, do not change silently)
 * ----------------------------------------------------
 * Export timestamps carry no timezone offset (`2024-02-07 00:00:00`). They are
 * interpreted as UTC instants, matching the JSON API, which returns the same
 * fields with an explicit `Z`. Reporting dates are derived by converting that
 * instant into the mapped community's configured IANA timezone and taking the
 * local calendar day. The browser timezone is never used.
 *
 * PII MINIMIZATION
 * ----------------
 * Exports include resident/prospect names, emails, phones, birthdates,
 * addresses and free-text notes. None of that is required for analytics, so
 * `stripPii()` removes it before the row is written to `metadata`. Nothing is
 * invented: a value only appears when the source actually provides it.
 */

export type Rec = Record<string, string>;

const clean = (v: string | undefined) => {
  if (v == null) return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "n/a") return null;
  return t;
};

/**
 * Keys carrying personal data or free text. Matched against the normalized
 * (underscored) key, so `people.first_name` → `people_first_name`.
 */
const PII_PATTERNS: RegExp[] = [
  /(^|_)(first|last|middle|full|preferred)_name$/,
  /(^|_)salutation$/,
  /(^|_)(email|email_address)$/,
  /(^|_)(cell|home|work|mobile)_phone$/,
  /(^|_)phone(_number)?$/,
  /(^|_)fax_number$/,
  /(^|_)birthdate$/,
  /(^|_)provided_age$/,
  /(^|_)gender$/,
  /(^|_)ssn$/,
  /^addresses_/,
  /(^|_)line1$/,
  /(^|_)line2$/,
  /(^|_)(city|state|zip|postal_code)$/,
  /(^|_)notes$/,
  /(^|_)story$/,
  /(^|_)details$/,
  /(^|_)description$/,
  /(^|_)comment(s)?$/,
  /(^|_)assigned_to_name$/,
  /(^|_)created_by_name$/,
  /(^|_)people_/,
];

export function isPiiKey(key: string): boolean {
  return PII_PATTERNS.some((p) => p.test(key));
}

/** Drops personal and free-text fields from a source row. */
export function stripPii(rec: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!isPiiKey(k)) out[k] = v;
  }
  return out;
}

/**
 * Adds bare-column aliases for the row's own table so normalizers can ask for
 * `id` / `created_at` regardless of the export's qualified headers.
 * Qualified keys are always preserved.
 */
export function aliasRecord(rec: Rec, prefix: string): Rec {
  const p = `${prefix}_`;
  const out: Rec = { ...rec };
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith(p)) {
      const bare = k.slice(p.length);
      if (bare) out[bare] = v;
    }
  }
  return out;
}

export function pick(rec: Rec, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = clean(rec[k]);
    if (v !== null) return v;
  }
  return null;
}

export function pickBool(rec: Rec, ...keys: string[]): boolean | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  const t = v.toLowerCase();
  // WelcomeHome CSV exports emit Postgres-style `t` / `f`.
  if (["true", "t", "yes", "y", "1"].includes(t)) return true;
  if (["false", "f", "no", "n", "0"].includes(t)) return false;
  return null;
}

export function pickNum(rec: Rec, ...keys: string[]): number | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function pickInt(rec: Rec, ...keys: string[]): number | null {
  const n = pickNum(rec, ...keys);
  return n === null ? null : Math.trunc(n);
}

/**
 * Parses a source timestamp into an ISO instant, or null when unparseable.
 * Naive `YYYY-MM-DD HH:MM:SS[.ffffff]` values are treated as UTC.
 */
export function pickTs(rec: Rec, ...keys: string[]): string | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  let iso = v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = `${v}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) {
    iso = `${v.replace(" ", "T")}Z`;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parses a source date-only value into yyyy-MM-dd, or null. */
export function pickDate(rec: Rec, ...keys: string[]): string | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  if (m) return m[1]!;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Converts a UTC instant to the community-local calendar date (yyyy-MM-dd). */
export function localDate(instantIso: string | null, timezone: string | null): string | null {
  if (!instantIso) return null;
  const tz = timezone || "UTC";
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    formatterCache.set(tz, fmt);
  }
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return null;
  return fmt.format(d);
}

/** Own-table prefix for each core export, used for alias resolution. */
export const WH_TABLE_PREFIX = {
  Prospects: "prospects",
  Activities: "activities",
  HousingContracts: "housing_contracts",
  Units: "units",
  MarketingTouchpoints: "marketing_touchpoints",
  DepositTransactions: "deposit_transactions",
} as const;

export function sourceId(rec: Rec): string | null {
  return pick(rec, "id", "source_id", "record_id", "uuid");
}

export function sourceCommunityId(rec: Rec): string | null {
  return pick(rec, "communities_id", "community_id", "community", "community_source_id");
}

export function updatedAt(rec: Rec): string | null {
  return pickTs(rec, "updated_at", "updated_at_utc", "last_updated_at", "modified_at");
}

type Ctx = {
  organizationId: string;
  connectionId: string;
  communityId: string | null;
  timezone: string | null;
};

export function normalizeProspect(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "prospects");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    account_id: pick(rec, "account_id"),
    status: pick(rec, "status"),
    stage_id: pick(rec, "stages_id", "stage_id"),
    stage_label: pick(rec, "stages_name"),
    score_id: pick(rec, "scores_id", "score_id"),
    score_label: pick(rec, "scores_name"),
    lead_source_id: pick(rec, "lead_sources_id", "lead_source_id"),
    lead_source_label: pick(rec, "lead_sources_name"),
    lead_source_category: pick(rec, "lead_sources_category"),
    secondary_lead_source_id: pick(rec, "secondary_lead_sources_id", "secondary_lead_source_id"),
    referrer_id: pick(rec, "referrer_id", "referrers_id"),
    active_at: pickTs(rec, "active_at"),
    inquiry_date: pickDate(rec, "inquiry_date"),
    expected_stay_type: pick(rec, "expected_stay_type"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    initial_contact_at: pickTs(rec, "initial_contact_at", "first_contact_at"),
    last_contact_at: pickTs(rec, "last_contact_at"),
    status_changed_at: pickTs(rec, "status_changed_at"),
    next_activity_scheduled_at: pickTs(
      rec,
      "next_activity_scheduled_at",
      "next_scheduled_activity_at",
    ),
    expected_move_timing_id: pick(rec, "expected_move_timing_id", "expected_move_timings_id"),
    original_sales_counselor_id: pick(rec, "original_sales_counselor_id"),
    current_sales_counselor_id: pick(rec, "current_sales_counselor_id", "sales_counselor_id"),
    close_reason_id: pick(rec, "close_reason_id", "close_reasons_id"),
    close_reason_label: pick(rec, "close_reasons_name"),
    merged_into_prospect_id: pick(rec, "merged_into_prospect_id", "merged_into_id"),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: stripPii(raw),
  };
}

export function normalizeActivity(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "activities");
  const completedAt = pickTs(rec, "completed_at", "completed_on");
  const scheduledAt = pickTs(rec, "scheduled_at", "scheduled_for");
  const recordType = pick(rec, "record_type");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    record_type: recordType,
    record_id: pick(rec, "record_id"),
    prospect_source_id:
      pick(rec, "prospect_id") ??
      (recordType?.toLowerCase() === "prospect" ? pick(rec, "record_id") : null),
    activity_type_id: pick(rec, "activity_type_id", "activity_types_id"),
    activity_type_label: pick(rec, "activity_types_name"),
    result_id: pick(rec, "result_id", "activity_result_id", "activity_results_id"),
    result_label: pick(rec, "activity_results_name"),
    direction: pick(rec, "direction"),
    stage_id: pick(rec, "stage_id", "stages_id"),
    stage_label: pick(rec, "stages_name"),
    user_id_source: pick(rec, "sales_counselor_id", "user_id", "counselor_id"),
    assigned_to_id: pick(rec, "assigned_to_id"),
    created_by_id: pick(rec, "created_by_id"),
    auto_performed: pickBool(rec, "auto_perform", "auto_performed"),
    first_completed_of_type: pickBool(rec, "first_completed_of_activity_type"),
    completed_successfully: pickBool(rec, "completed_successfully"),
    scheduled_at: scheduledAt,
    completed_at: completedAt,
    completed_local_date: localDate(completedAt, ctx.timezone),
    scheduled_local_date: localDate(scheduledAt, ctx.timezone),
    source_timezone: pick(rec, "timezone", "time_zone"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: stripPii(raw),
  };
}

export function normalizeHousingContract(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "housing_contracts");
  const depositAt = pickTs(rec, "deposit_received_at", "deposit_received_on", "deposit_date");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id", "prospects_id"),
    resident_source_id: pick(rec, "resident_id", "residents_id"),
    resident_source_ids: pick(rec, "resident_ids"),
    resident_count: pickInt(rec, "resident_count", "occupants"),
    unit_source_id: pick(rec, "unit_id", "units_id"),
    unit_number: pick(rec, "units_number", "units_unit_number"),
    status: pick(rec, "status", "contract_status"),
    financial_status: pick(rec, "financial_status"),
    risk_level: pick(rec, "risk_level", "risk"),
    contract_type: pick(rec, "contract_type"),
    stay_type: pick(rec, "stay_type"),
    privacy_level_id: pick(rec, "privacy_level_id", "privacy_levels_id"),
    privacy_level_label: pick(rec, "privacy_levels_name"),
    care_type_id_source: pick(rec, "care_type_id", "care_types_id"),
    care_type_label: pick(rec, "care_types_name", "care_types_abbreviation"),
    move_in_date: pickDate(rec, "move_in_date", "moved_in_on"),
    financial_move_in_date: pickDate(rec, "financial_move_in_date", "financial_move_in_on"),
    move_out_date: pickDate(rec, "move_out_date", "moved_out_on"),
    financial_move_out_date: pickDate(rec, "financial_move_out_date", "financial_move_out_on"),
    notice_date: pickDate(rec, "notice_date", "notice_given_date", "notice_given_on"),
    leased_on: pickDate(rec, "leased_on", "lease_signed_on", "lease_date"),
    lease_canceled_on: pickDate(rec, "lease_canceled_on", "canceled_on"),
    community_fee_received_on: pickDate(rec, "community_fee_received_on"),
    count_move_in: pickBool(rec, "count_move_in"),
    count_move_out: pickBool(rec, "count_move_out"),
    is_transfer: pickBool(rec, "transfer", "is_transfer"),
    move_out_reason_id: pick(rec, "move_out_reason_id", "move_out_reasons_id"),
    move_out_reason_label: pick(rec, "move_out_reasons_name"),
    occupancy_point_factor: pickNum(rec, "occupancy_point_factor", "occupancy_points"),
    monthly_rate: pickNum(rec, "monthly_rate", "rate", "base_rate"),
    care_rate: pickNum(rec, "care_rate"),
    community_fee: pickNum(rec, "community_fee", "community_fee_amount"),
    concessions: pickNum(rec, "concessions", "concession_amount"),
    one_time_concession: pickNum(rec, "one_time_concession"),
    recurring_concession: pickNum(rec, "recurring_concession"),
    deposit_amount: pickNum(rec, "deposit_amount", "deposit"),
    deposit_received_at: depositAt,
    deposit_received_date: localDate(depositAt, ctx.timezone),
    sales_counselor_id: pick(rec, "sales_counselor_id", "counselor_id"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: stripPii(raw),
  };
}

export function normalizeUnit(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "units");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    unit_number: pick(rec, "number", "unit_number"),
    unit_name: pick(rec, "name", "unit_name"),
    floor: pick(rec, "floor"),
    care_type_id_source: pick(rec, "care_type_id", "care_types_id"),
    care_type_label: pick(rec, "care_types_name", "care_types_abbreviation"),
    floor_plan_id: pick(rec, "floor_plan_id", "floor_plans_id"),
    floor_plan_label: pick(rec, "floor_plans_name"),
    floor_plan_occupancy_points: pickNum(rec, "floor_plans_occupancy_points"),
    privacy_level_id: pick(rec, "privacy_level_id", "privacy_levels_id"),
    square_feet: pickNum(rec, "square_feet", "sq_ft", "floor_plans_square_feet"),
    market_rate: pickNum(rec, "market_rate"),
    off_census: pickBool(rec, "off_census"),
    status: pick(rec, "status"),
    occupancy_point_factor: pickNum(rec, "occupancy_point_factor", "occupancy_points"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: stripPii(raw),
  };
}

export function normalizeTouchpoint(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "marketing_touchpoints");
  const occurred = pickTs(rec, "occurred_at", "touchpoint_at", "created_at");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id", "prospects_id"),
    lead_source_id: pick(rec, "lead_source_id", "lead_sources_id"),
    lead_source_label: pick(rec, "lead_sources_name"),
    campaign_name: pick(rec, "campaign_name", "campaign"),
    added_by_type: pick(rec, "added_by_type", "source_type"),
    locked: pickBool(rec, "locked"),
    occurred_at: occurred,
    occurred_local_date: localDate(occurred, ctx.timezone),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    metadata: stripPii(raw),
  };
}

export function normalizeDeposit(raw: Rec, ctx: Ctx) {
  const rec = aliasRecord(raw, "deposit_transactions");
  const occurred = pickTs(rec, "occurred_at", "transaction_at", "received_at", "created_at");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id", "prospects_id"),
    resident_source_id: pick(rec, "resident_id", "residents_id"),
    housing_contract_source_id: pick(
      rec,
      "housing_contract_id",
      "contract_id",
      "housing_contracts_id",
    ),
    transaction_type: pick(rec, "transaction_type", "type", "deposit_types_name"),
    deposit_type_id: pick(rec, "deposit_type_id", "deposit_types_id"),
    is_refund: pickBool(rec, "refund", "is_refund"),
    amount: pickNum(rec, "amount"),
    occurred_at: occurred,
    occurred_local_date: localDate(occurred, ctx.timezone),
    refunded_at: pickTs(rec, "refunded_at"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: stripPii(raw),
  };
}

export const NORMALIZERS = {
  Prospects: normalizeProspect,
  Activities: normalizeActivity,
  HousingContracts: normalizeHousingContract,
  Units: normalizeUnit,
  MarketingTouchpoints: normalizeTouchpoint,
  DepositTransactions: normalizeDeposit,
} as const;
