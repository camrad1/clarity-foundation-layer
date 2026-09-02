/**
 * Deterministic WelcomeHome candidate metric calculations.
 *
 * Nothing here is AI-derived or estimated. Every number is a count or a ratio
 * of counts over rows the database returned under row level security.
 *
 * Metrics whose official WelcomeHome definition is still unresolved return an
 * `unresolved` result instead of a number, so the interface can withhold it
 * rather than present a value users might trust. See the validation queue
 * (V-001 … V-007) in the Reconciliation workspace.
 */

import type {
  WhActivity,
  WhContract,
  WhDeposit,
  WhProspect,
  WhSettings,
  WhUnit,
} from "./queries";
import type { WhActivityCategory, WhScoreLevel } from "./tables";

export type CandidateValue =
  | { resolved: true; value: number; ids: string[]; note: string }
  | { resolved: false; reason: string };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** UTC instant → community-local calendar date. Browser timezone is never used. */
export function localDateOf(iso: string | null, timezone: string | null): string | null {
  if (!iso) return null;
  const tz = timezone || "UTC";
  let fmt = fmtCache.get(tz);
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
    fmtCache.set(tz, fmt);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmt.format(d);
}

const inRange = (date: string | null, start: string, end: string) =>
  !!date && date >= start && date <= end;

export type CommunityTz = Record<string, string | null>;

// ---------------------------------------------------------------------------
// Prospect eligibility — PROVISIONAL, validate before metric approval
// ---------------------------------------------------------------------------

/**
 * PROVISIONAL RULE: a prospect merged into another prospect, or discarded, is
 * excluded from lead/inquiry counts so a duplicate is never counted twice. The
 * row itself is always retained for audit. Configurable in wh_settings, and
 * not locked until reconciled against WelcomeHome reporting.
 */
export function isCountableProspect(p: WhProspect, s: WhSettings) {
  if (s.exclude_merged_prospects && p.merged_into_prospect_id) return false;
  if (s.exclude_discarded_prospects && p.discarded_at) return false;
  return true;
}

export function prospectExclusionBreakdown(prospects: WhProspect[]) {
  const merged = prospects.filter((p) => p.merged_into_prospect_id).length;
  const discarded = prospects.filter((p) => p.discarded_at && !p.merged_into_prospect_id).length;
  return { total: prospects.length, merged, discarded, countable: prospects.length - merged - discarded };
}

export const INQUIRY_DATE_FIELDS = [
  { value: "created_at_source", label: "created_at (source record creation)" },
  { value: "initial_contact_at", label: "initial_contact_at" },
  { value: "active_at", label: "active_at" },
] as const;

export function inquiryInstant(p: WhProspect, field: string): string | null {
  if (field === "initial_contact_at") return p.initial_contact_at;
  if (field === "active_at") return p.active_at;
  return p.created_at_source;
}

/** wh.new_inquiries — PROVISIONAL until V-001 resolves the official date field. */
export function candidateInquiries(
  prospects: WhProspect[],
  settings: WhSettings,
  tz: CommunityTz,
  start: string,
  end: string,
): CandidateValue {
  const ids = prospects
    .filter((p) => isCountableProspect(p, settings))
    .filter((p) =>
      inRange(
        localDateOf(inquiryInstant(p, settings.inquiry_date_field), tz[p.community_id ?? ""] ?? null),
        start,
        end,
      ),
    )
    .map((p) => p.id);
  return {
    resolved: true,
    value: ids.length,
    ids,
    note: `Provisional — inquiry date field: ${settings.inquiry_date_field}`,
  };
}

// ---------------------------------------------------------------------------
// Activities / tours
// ---------------------------------------------------------------------------

export type ActivityCategoryMap = Record<string, WhActivityCategory>;

export function buildActivityCategoryMap(
  rows: { activity_type_id: string; category: string }[],
): ActivityCategoryMap {
  const map: ActivityCategoryMap = {};
  for (const r of rows) map[r.activity_type_id] = r.category as WhActivityCategory;
  return map;
}

function activitiesInCategory(
  activities: WhActivity[],
  map: ActivityCategoryMap,
  category: WhActivityCategory,
  start: string,
  end: string,
) {
  return activities.filter(
    (a) =>
      !a.discarded_at &&
      a.completed_at &&
      a.activity_type_id &&
      map[a.activity_type_id] === category &&
      inRange(a.completed_local_date, start, end),
  );
}

/** wh.completed_tours — requires at least one activity type mapped to Tour. */
export function candidateTours(
  activities: WhActivity[],
  map: ActivityCategoryMap,
  start: string,
  end: string,
): CandidateValue {
  if (!Object.values(map).includes("tour")) {
    return { resolved: false, reason: "No WelcomeHome activity type is mapped to Tour (V-002)." };
  }
  const rows = activitiesInCategory(activities, map, "tour", start, end);
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: "Provisional — completed_at within period, community-local date",
  };
}

/** wh.re_tours — never inferred. Only counted when a distinct type is mapped. */
export function candidateReTours(
  activities: WhActivity[],
  map: ActivityCategoryMap,
  start: string,
  end: string,
): CandidateValue {
  if (!Object.values(map).includes("re_tour")) {
    return {
      resolved: false,
      reason: "No WelcomeHome activity type is mapped to Re-Tour. Definition unresolved (V-002).",
    };
  }
  const rows = activitiesInCategory(activities, map, "re_tour", start, end);
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: "Provisional — distinct Re-Tour activity type",
  };
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/** wh.deposits — PROVISIONAL until V-003 selects the official source. */
export function candidateDeposits(
  deposits: WhDeposit[],
  contracts: WhContract[],
  settings: WhSettings,
  start: string,
  end: string,
): CandidateValue {
  if (settings.deposit_source === "housing_contracts") {
    const rows = contracts.filter(
      (c) => c.deposit_amount != null && inRange(c.deposit_received_date, start, end),
    );
    return {
      resolved: true,
      value: rows.length,
      ids: rows.map((r) => r.id),
      note: "Provisional — HousingContract deposit fields",
    };
  }
  const rows = deposits.filter(
    (d) => !d.discarded_at && !d.refunded_at && inRange(d.occurred_local_date, start, end),
  );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: "Provisional — DepositTransactions, refunds excluded",
  };
}

export function depositReconciliation(
  deposits: WhDeposit[],
  contracts: WhContract[],
  start: string,
  end: string,
) {
  return {
    fromTransactions: deposits.filter(
      (d) => !d.discarded_at && !d.refunded_at && inRange(d.occurred_local_date, start, end),
    ).length,
    fromContracts: contracts.filter(
      (c) => c.deposit_amount != null && inRange(c.deposit_received_date, start, end),
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Move-ins / move-outs
// ---------------------------------------------------------------------------

export const MOVE_IN_DATE_FIELDS = [
  { value: "move_in_date", label: "move_in_date" },
  { value: "financial_move_in_date", label: "financial_move_in_date" },
] as const;

export const MOVE_OUT_DATE_FIELDS = [
  { value: "move_out_date", label: "move_out_date" },
  { value: "financial_move_out_date", label: "financial_move_out_date" },
] as const;

export function moveInDate(c: WhContract, field: string) {
  return field === "financial_move_in_date" ? c.financial_move_in_date : c.move_in_date;
}
export function moveOutDate(c: WhContract, field: string) {
  return field === "financial_move_out_date" ? c.financial_move_out_date : c.move_out_date;
}

/** wh.move_ins — PROVISIONAL until V-004 selects the official date field. */
export function candidateMoveIns(
  contracts: WhContract[],
  settings: WhSettings,
  start: string,
  end: string,
): CandidateValue {
  const rows = contracts.filter(
    (c) => c.count_move_in === true && inRange(moveInDate(c, settings.move_in_date_field), start, end),
  );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: `Provisional — count_move_in and ${settings.move_in_date_field}`,
  };
}

/** wh.move_outs — PROVISIONAL until V-004 selects the official date field. */
export function candidateMoveOuts(
  contracts: WhContract[],
  settings: WhSettings,
  start: string,
  end: string,
): CandidateValue {
  const rows = contracts.filter(
    (c) =>
      c.count_move_out === true && inRange(moveOutDate(c, settings.move_out_date_field), start, end),
  );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: `Provisional — count_move_out and ${settings.move_out_date_field}`,
  };
}

/** wh.net_move_ins — only as trustworthy as its two inputs. */
export function candidateNetMoveIns(mi: CandidateValue, mo: CandidateValue): CandidateValue {
  if (!mi.resolved || !mo.resolved)
    return { resolved: false, reason: "Move-in or move-out definition unresolved." };
  return {
    resolved: true,
    value: mi.value - mo.value,
    ids: [],
    note: "Provisional — derived from move-in and move-out candidates",
  };
}

/** Pending (future-dated) move-ins and move-outs from contract dates. */
export function pendingMimo(contracts: WhContract[], settings: WhSettings, today: string) {
  const pendingIn = contracts.filter(
    (c) => c.count_move_in === true && (moveInDate(c, settings.move_in_date_field) ?? "") > today,
  );
  const pendingOut = contracts.filter(
    (c) => c.count_move_out === true && (moveOutDate(c, settings.move_out_date_field) ?? "") > today,
  );
  return { pendingIn: pendingIn.length, pendingOut: pendingOut.length };
}

// ---------------------------------------------------------------------------
// Occupancy — WITHHELD until validated (V-005)
// ---------------------------------------------------------------------------

export type OccupancyComponents = {
  totalUnits: number;
  offCensusUnits: number;
  censusUnits: number;
  occupiedUnitsCandidate: number;
  noticeCount: number;
  pendingMoveIns: number;
  candidatePct: number | null;
};

/**
 * Returns the raw source components only. ClarityIQ deliberately does NOT
 * publish an occupancy KPI until the candidate is reconciled against official
 * operational census.
 */
export function occupancyComponents(
  units: WhUnit[],
  contracts: WhContract[],
  settings: WhSettings,
  today: string,
): OccupancyComponents {
  const totalUnits = units.length;
  const offCensusUnits = units.filter((u) => u.off_census === true).length;
  const censusUnits = totalUnits - offCensusUnits;
  const occupiedUnits = new Set(
    contracts
      .filter((c) => {
        const mi = moveInDate(c, settings.move_in_date_field);
        const mo = moveOutDate(c, settings.move_out_date_field);
        return !!mi && mi <= today && (!mo || mo > today);
      })
      .map((c) => c.unit_source_id)
      .filter((u): u is string => !!u),
  );
  const noticeCount = contracts.filter((c) => c.notice_date && c.notice_date <= today && (!c.move_out_date || c.move_out_date > today)).length;
  const pendingMoveIns = contracts.filter(
    (c) => (moveInDate(c, settings.move_in_date_field) ?? "") > today,
  ).length;
  return {
    totalUnits,
    offCensusUnits,
    censusUnits,
    occupiedUnitsCandidate: occupiedUnits.size,
    noticeCount,
    pendingMoveIns,
    candidatePct: censusUnits > 0 ? occupiedUnits.size / censusUnits : null,
  };
}

// ---------------------------------------------------------------------------
// Pipeline (current state only)
// ---------------------------------------------------------------------------

export type ScoreLevelMap = Record<string, WhScoreLevel>;

export function buildScoreLevelMap(rows: { score_id: string; level: string }[]): ScoreLevelMap {
  const map: ScoreLevelMap = {};
  for (const r of rows) map[r.score_id] = r.level as WhScoreLevel;
  return map;
}

const OPEN_STATUS = (p: WhProspect) => {
  const s = (p.status ?? "").toLowerCase();
  return !p.discarded_at && !p.merged_into_prospect_id && !["closed", "lost", "inactive"].includes(s);
};

export function activePipeline(prospects: WhProspect[], settings: WhSettings) {
  return prospects.filter((p) => isCountableProspect(p, settings) && OPEN_STATUS(p));
}

/** wh.hot_leads — unresolved until at least one score is mapped to Hot. */
export function candidateHotLeads(
  prospects: WhProspect[],
  settings: WhSettings,
  scoreMap: ScoreLevelMap,
): CandidateValue {
  if (!Object.values(scoreMap).includes("hot")) {
    return { resolved: false, reason: "No WelcomeHome score is mapped to Hot." };
  }
  const rows = activePipeline(prospects, settings).filter(
    (p) => p.score_id && scoreMap[p.score_id] === "hot",
  );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: "Current state — mapped Hot score on an open prospect",
  };
}

/**
 * wh.hot_no_future_activity — the operational policy is configurable:
 *  - none_scheduled: next_activity_scheduled_at is null
 *  - none_or_overdue: null OR scheduled in the past
 */
export function candidateHotNoFutureActivity(
  prospects: WhProspect[],
  settings: WhSettings,
  scoreMap: ScoreLevelMap,
  nowIso: string,
): CandidateValue {
  const hot = candidateHotLeads(prospects, settings, scoreMap);
  if (!hot.resolved) return hot;
  const rows = activePipeline(prospects, settings)
    .filter((p) => p.score_id && scoreMap[p.score_id] === "hot")
    .filter((p) =>
      settings.hot_no_activity_mode === "none_or_overdue"
        ? !p.next_activity_scheduled_at || p.next_activity_scheduled_at < nowIso
        : !p.next_activity_scheduled_at,
    );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: `Current state — policy: ${settings.hot_no_activity_mode}`,
  };
}

export function overdueNextActivity(prospects: WhProspect[], settings: WhSettings, nowIso: string) {
  return activePipeline(prospects, settings).filter(
    (p) => p.next_activity_scheduled_at && p.next_activity_scheduled_at < nowIso,
  );
}

/** wh.stalled_prospects — threshold is configuration, never a magic number. */
export function candidateStalled(
  prospects: WhProspect[],
  settings: WhSettings,
  nowIso: string,
): CandidateValue {
  const cutoff = new Date(
    new Date(nowIso).getTime() - settings.stalled_threshold_days * 86_400_000,
  ).toISOString();
  const rows = activePipeline(prospects, settings).filter(
    (p) => (p.last_contact_at ?? p.created_at_source ?? "") < cutoff,
  );
  return {
    resolved: true,
    value: rows.length,
    ids: rows.map((r) => r.id),
    note: `Current state — no contact for ${settings.stalled_threshold_days}+ days`,
  };
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export type EventPeriodFunnel = {
  inquiries: number;
  tours: number | null;
  deposits: number;
  moveIns: number;
};

/** Cohort conversion: leads CREATED in the period that later converted. */
export function cohortConversion(args: {
  prospects: WhProspect[];
  activities: WhActivity[];
  contracts: WhContract[];
  deposits: WhDeposit[];
  settings: WhSettings;
  activityMap: ActivityCategoryMap;
  tz: CommunityTz;
  start: string;
  end: string;
}) {
  const cohort = args.prospects
    .filter((p) => isCountableProspect(p, args.settings))
    .filter((p) =>
      inRange(
        localDateOf(
          inquiryInstant(p, args.settings.inquiry_date_field),
          args.tz[p.community_id ?? ""] ?? null,
        ),
        args.start,
        args.end,
      ),
    );
  const cohortIds = new Set(cohort.map((p) => p.source_id));
  const hasTourMapping = Object.values(args.activityMap).includes("tour");

  const touredIds = new Set(
    args.activities
      .filter(
        (a) =>
          !a.discarded_at &&
          a.completed_at &&
          a.activity_type_id &&
          args.activityMap[a.activity_type_id] === "tour" &&
          a.prospect_source_id &&
          cohortIds.has(a.prospect_source_id),
      )
      .map((a) => a.prospect_source_id as string),
  );
  const depositedIds = new Set(
    args.deposits
      .filter(
        (d) =>
          !d.discarded_at &&
          !d.refunded_at &&
          d.prospect_source_id &&
          cohortIds.has(d.prospect_source_id),
      )
      .map((d) => d.prospect_source_id as string),
  );
  const movedInIds = new Set(
    args.contracts
      .filter(
        (c) =>
          c.count_move_in === true &&
          moveInDate(c, args.settings.move_in_date_field) &&
          c.prospect_source_id &&
          cohortIds.has(c.prospect_source_id),
      )
      .map((c) => c.prospect_source_id as string),
  );

  return {
    cohortSize: cohort.length,
    toured: hasTourMapping ? touredIds.size : null,
    deposited: depositedIds.size,
    movedIn: movedInIds.size,
    /** True when prospect linkage is present often enough to trust the cohort. */
    linkageCoverage:
      args.activities.length === 0
        ? null
        : args.activities.filter((a) => a.prospect_source_id).length / args.activities.length,
  };
}

export function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// UTM / digital metadata coverage
// ---------------------------------------------------------------------------

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export function utmCoverage(prospects: WhProspect[]) {
  const total = prospects.length;
  const counts: Record<string, number> = {};
  for (const key of UTM_KEYS) counts[key] = 0;
  for (const p of prospects) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    for (const key of UTM_KEYS) {
      const v = meta[key];
      if (typeof v === "string" && v.trim() !== "") counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return { total, counts };
}

// ---------------------------------------------------------------------------
// Flash week (Friday → Thursday)
// ---------------------------------------------------------------------------

/** Returns the Friday→Thursday week containing `today` (ISO yyyy-MM-dd). */
export function flashWeek(today = new Date()) {
  const d = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun … 5 Fri
  const daysSinceFriday = (dow - 5 + 7) % 7;
  const start = new Date(d.getTime() - daysSinceFriday * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
