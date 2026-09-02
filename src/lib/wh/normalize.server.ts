/**
 * WelcomeHome record normalization — SERVER ONLY.
 *
 * DATE DERIVATION (documented, do not change silently)
 * ----------------------------------------------------
 * WelcomeHome timestamps are treated as UTC instants. Reporting dates are
 * derived by converting the instant into the mapped community's configured
 * IANA timezone and taking that local calendar day. The browser timezone is
 * never used. Example: an activity completed at 01:00 UTC belongs to the
 * previous local calendar day for a community in America/Phoenix.
 *
 * Field selection is tolerant of header casing/format differences because the
 * export column names are the CRM's, not ours. No field is invented: a value
 * only appears when the source actually provides it, otherwise it is null and
 * the entire source row is retained in `metadata` for audit.
 */

export type Rec = Record<string, string>;

const clean = (v: string | undefined) => {
  if (v == null) return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "n/a") return null;
  return t;
};

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

/** Parses a source timestamp into an ISO instant, or null when unparseable. */
export function pickTs(rec: Rec, ...keys: string[]): string | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parses a source date-only value into yyyy-MM-dd, or null. */
export function pickDate(rec: Rec, ...keys: string[]): string | null {
  const v = pick(rec, ...keys);
  if (v === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
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

export function sourceId(rec: Rec): string | null {
  return pick(rec, "id", "source_id", "record_id", "uuid");
}

export function sourceCommunityId(rec: Rec): string | null {
  return pick(rec, "community_id", "community", "community_source_id", "communities_id");
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

export function normalizeProspect(rec: Rec, ctx: Ctx) {
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    account_id: pick(rec, "account_id"),
    status: pick(rec, "status", "prospect_status"),
    stage_id: pick(rec, "stage_id"),
    score_id: pick(rec, "score_id"),
    lead_source_id: pick(rec, "lead_source_id"),
    secondary_lead_source_id: pick(rec, "secondary_lead_source_id"),
    referrer_id: pick(rec, "referrer_id"),
    active_at: pickTs(rec, "active_at"),
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
    expected_move_timing_id: pick(rec, "expected_move_timing_id"),
    original_sales_counselor_id: pick(rec, "original_sales_counselor_id"),
    current_sales_counselor_id: pick(rec, "current_sales_counselor_id", "sales_counselor_id"),
    close_reason_id: pick(rec, "close_reason_id"),
    merged_into_prospect_id: pick(rec, "merged_into_prospect_id", "merged_into_id"),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: rec,
  };
}

export function normalizeActivity(rec: Rec, ctx: Ctx) {
  const completedAt = pickTs(rec, "completed_at", "completed_on");
  const scheduledAt = pickTs(rec, "scheduled_at", "scheduled_for");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    record_type: pick(rec, "record_type"),
    record_id: pick(rec, "record_id"),
    prospect_source_id:
      pick(rec, "prospect_id") ??
      (pick(rec, "record_type")?.toLowerCase() === "prospect" ? pick(rec, "record_id") : null),
    activity_type_id: pick(rec, "activity_type_id", "type_id"),
    result_id: pick(rec, "result_id", "activity_result_id"),
    direction: pick(rec, "direction"),
    stage_id: pick(rec, "stage_id"),
    user_id_source: pick(rec, "user_id", "counselor_id", "sales_counselor_id"),
    completed_successfully: pickBool(rec, "completed_successfully"),
    scheduled_at: scheduledAt,
    completed_at: completedAt,
    completed_local_date: localDate(completedAt, ctx.timezone),
    scheduled_local_date: localDate(scheduledAt, ctx.timezone),
    source_timezone: pick(rec, "timezone", "time_zone"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: rec,
  };
}

export function normalizeHousingContract(rec: Rec, ctx: Ctx) {
  const depositAt = pickTs(rec, "deposit_received_at", "deposit_date");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id"),
    resident_source_id: pick(rec, "resident_id"),
    unit_source_id: pick(rec, "unit_id"),
    status: pick(rec, "status", "contract_status"),
    contract_type: pick(rec, "contract_type"),
    stay_type: pick(rec, "stay_type"),
    privacy_level_id: pick(rec, "privacy_level_id"),
    care_type_id_source: pick(rec, "care_type_id"),
    move_in_date: pickDate(rec, "move_in_date"),
    financial_move_in_date: pickDate(rec, "financial_move_in_date"),
    move_out_date: pickDate(rec, "move_out_date"),
    financial_move_out_date: pickDate(rec, "financial_move_out_date"),
    notice_date: pickDate(rec, "notice_date", "notice_given_date"),
    count_move_in: pickBool(rec, "count_move_in"),
    count_move_out: pickBool(rec, "count_move_out"),
    is_transfer: pickBool(rec, "transfer", "is_transfer"),
    move_out_reason_id: pick(rec, "move_out_reason_id"),
    occupancy_point_factor: pickNum(rec, "occupancy_point_factor"),
    monthly_rate: pickNum(rec, "monthly_rate", "rate", "base_rate"),
    care_rate: pickNum(rec, "care_rate"),
    community_fee: pickNum(rec, "community_fee"),
    concessions: pickNum(rec, "concessions", "concession_amount"),
    deposit_amount: pickNum(rec, "deposit_amount", "deposit"),
    deposit_received_at: depositAt,
    deposit_received_date: localDate(depositAt, ctx.timezone),
    sales_counselor_id: pick(rec, "sales_counselor_id", "counselor_id"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: rec,
  };
}

export function normalizeUnit(rec: Rec, ctx: Ctx) {
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    unit_number: pick(rec, "unit_number", "number"),
    unit_name: pick(rec, "name", "unit_name"),
    floor: pick(rec, "floor"),
    care_type_id_source: pick(rec, "care_type_id"),
    floor_plan_id: pick(rec, "floor_plan_id"),
    privacy_level_id: pick(rec, "privacy_level_id"),
    square_feet: pickNum(rec, "square_feet", "sq_ft"),
    market_rate: pickNum(rec, "market_rate"),
    off_census: pickBool(rec, "off_census"),
    status: pick(rec, "status"),
    occupancy_point_factor: pickNum(rec, "occupancy_point_factor"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: rec,
  };
}

export function normalizeTouchpoint(rec: Rec, ctx: Ctx) {
  const occurred = pickTs(rec, "occurred_at", "touchpoint_at", "created_at");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id"),
    lead_source_id: pick(rec, "lead_source_id"),
    campaign_name: pick(rec, "campaign_name", "campaign"),
    occurred_at: occurred,
    occurred_local_date: localDate(occurred, ctx.timezone),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    metadata: rec,
  };
}

export function normalizeDeposit(rec: Rec, ctx: Ctx) {
  const occurred = pickTs(rec, "occurred_at", "transaction_at", "received_at", "created_at");
  return {
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    source_id: sourceId(rec)!,
    community_id: ctx.communityId,
    source_community_id: sourceCommunityId(rec),
    prospect_source_id: pick(rec, "prospect_id"),
    housing_contract_source_id: pick(rec, "housing_contract_id", "contract_id"),
    transaction_type: pick(rec, "transaction_type", "type"),
    amount: pickNum(rec, "amount"),
    occurred_at: occurred,
    occurred_local_date: localDate(occurred, ctx.timezone),
    refunded_at: pickTs(rec, "refunded_at"),
    created_at_source: pickTs(rec, "created_at"),
    updated_at_source: updatedAt(rec),
    discarded_at: pickTs(rec, "discarded_at"),
    metadata: rec,
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
