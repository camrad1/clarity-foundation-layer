/**
 * Further field normalizers — SERVER ONLY.
 *
 * Further payload shapes vary by dataset and can change, so every normalizer
 * is defensive: it reads a known set of candidate field names, preserves the
 * complete raw payload for audit, and never invents a value. A field that is
 * absent stays null rather than being guessed.
 */

export type Row = Record<string, unknown>;

export function pick(row: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export function str(row: Row, ...keys: string[]): string | null {
  const v = pick(row, ...keys);
  if (v === null) return null;
  if (typeof v === "object") {
    const o = v as Row;
    const nested = pick(o, "name", "title", "id", "uuid");
    return nested === null ? null : String(nested);
  }
  return String(v);
}

export function num(row: Row, ...keys: string[]): number | null {
  const v = pick(row, ...keys);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function int(row: Row, ...keys: string[]): number | null {
  const n = num(row, ...keys);
  return n === null ? null : Math.round(n);
}

export function bool(row: Row, ...keys: string[]): boolean | null {
  const v = pick(row, ...keys);
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(s)) return true;
  if (["false", "f", "no", "n", "0"].includes(s)) return false;
  return null;
}

/** ISO timestamp, or null when the value is not a parseable instant. */
export function ts(row: Row, ...keys: string[]): string | null {
  const v = pick(row, ...keys);
  if (v === null) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Date-only value kept literal — never shifted by a timezone conversion. */
export function dateOnly(row: Row, ...keys: string[]): string | null {
  const v = pick(row, ...keys);
  if (v === null) return null;
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1]!;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Flattens url_parameters whether it arrives as an object or a query string. */
export function urlParams(row: Row): Record<string, string> {
  const v = pick(row, "url_parameters", "urlParameters", "url_params", "query_parameters");
  const out: Record<string, string> = {};
  if (v === null) return out;
  if (typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Row)) {
      if (val !== null && val !== undefined) out[k] = String(val);
    }
    return out;
  }
  const raw = String(v);
  const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  for (const [k, val] of new URLSearchParams(qs).entries()) out[k] = val;
  return out;
}

export type FurtherCommunityRow = {
  further_community_id: string;
  further_uuid: string | null;
  name: string | null;
  slug: string | null;
  further_organization_id: string | null;
  url: string | null;
  payload: Row;
};

export function normalizeCommunity(row: Row): FurtherCommunityRow | null {
  const id = str(row, "id", "community_id", "pk", "uuid");
  if (!id) return null;
  return {
    further_community_id: id,
    further_uuid: str(row, "uuid", "community_uuid", "guid"),
    name: str(row, "name", "community_name", "title"),
    slug: str(row, "slug", "community_slug"),
    further_organization_id: str(row, "organization", "organization_id", "org_id", "organization_uuid"),
    url: str(row, "url", "website", "community_url", "site_url"),
    payload: row,
  };
}

export type FurtherLeadRow = {
  further_lead_id: string;
  external_lead_id: string | null;
  visitor_uuid: string | null;
  further_community_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_on: string | null;
  source_updated_at: string | null;
  financially_unqualified: boolean | null;
  move_in_date: string | null;
  channel_source: string | null;
  lead_submitted: boolean | null;
  device: string | null;
  traffic_source: string | null;
  tours_count: number | null;
  tour_date: string | null;
  tour_scheduled: boolean | null;
  tour_confirmed: boolean | null;
  payload: Row;
};

export function normalizeLead(row: Row): FurtherLeadRow | null {
  const id = str(row, "id", "lead_id", "pk", "uuid");
  if (!id) return null;
  const first = str(row, "first_name", "firstname");
  const last = str(row, "last_name", "lastname");
  const name =
    str(row, "name", "full_name", "lead_name") ?? ([first, last].filter(Boolean).join(" ") || null);
  return {
    further_lead_id: id,
    external_lead_id: str(row, "external_lead_id", "externalLeadId", "external_id"),
    visitor_uuid: str(row, "visitor_uuid", "visitorUuid", "visitor"),
    further_community_id: str(row, "community", "community_id", "communityId"),
    full_name: name,
    email: str(row, "email", "email_address"),
    phone: str(row, "phone", "phone_number", "telephone"),
    created_on: ts(row, "created_on", "created_at", "created", "createdOn", "date_created"),
    source_updated_at: ts(row, "updated_on", "updated_at", "modified_on", "last_updated", "updatedOn"),
    financially_unqualified: bool(row, "financially_unqualified", "financiallyUnqualified"),
    move_in_date: dateOnly(row, "move_in_date", "moveInDate", "move_in"),
    channel_source: str(row, "channel_source", "channelSource", "channel"),
    lead_submitted: bool(row, "lead_submitted", "leadSubmitted", "submitted"),
    device: str(row, "device", "device_type"),
    traffic_source: str(row, "traffic_source", "trafficSource", "source"),
    tours_count: int(row, "tours_count", "toursCount", "tour_count"),
    tour_date: ts(row, "tour_date", "tourDate"),
    tour_scheduled: bool(row, "tour_scheduled", "tourScheduled"),
    tour_confirmed: bool(row, "tour_confirmed", "tourConfirmed"),
    payload: row,
  };
}

export type FurtherLeadDetailRow = {
  further_lead_id: string;
  external_lead_id: string | null;
  visitor_uuid: string | null;
  score: number | null;
  care_type: string | null;
  traffic_source: string | null;
  hash_code: string | null;
  url_parameters: Record<string, string>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  further_community_id: string | null;
  payload: Row;
};

export function normalizeLeadDetail(leadId: string, row: Row): FurtherLeadDetailRow {
  const params = urlParams(row);
  const p = (k: string) => params[k] ?? params[k.toUpperCase()] ?? null;
  return {
    further_lead_id: str(row, "id", "lead_id") ?? leadId,
    external_lead_id: str(row, "external_lead_id", "externalLeadId", "external_id"),
    visitor_uuid: str(row, "visitor_uuid", "visitorUuid", "visitor"),
    score: num(row, "score", "lead_score"),
    care_type: str(row, "care_type", "careType", "care"),
    traffic_source: str(row, "traffic_source", "trafficSource"),
    hash_code: str(row, "hash_code", "hashCode", "hash"),
    url_parameters: params,
    utm_source: p("utm_source"),
    utm_medium: p("utm_medium"),
    utm_campaign: p("utm_campaign"),
    utm_term: p("utm_term"),
    utm_content: p("utm_content"),
    gclid: p("gclid"),
    further_community_id: str(row, "community", "community_id"),
    payload: row,
  };
}

export type FurtherVisitorRow = {
  visitor_uuid: string;
  occurred_at: string | null;
  further_community_id: string | null;
  referrer: string | null;
  traffic_source: string | null;
  payload: Row;
};

export function normalizeVisitor(row: Row): FurtherVisitorRow | null {
  const uuid = str(row, "visitor_uuid", "uuid", "visitorUuid", "id");
  if (!uuid) return null;
  return {
    visitor_uuid: uuid,
    occurred_at: ts(row, "timestamp", "created_on", "created_at", "occurred_at", "visited_at"),
    further_community_id: str(row, "community", "community_id", "communityId"),
    referrer: str(row, "referrer", "referer", "referring_url"),
    traffic_source: str(row, "traffic_source", "trafficSource", "source"),
    payload: row,
  };
}

export type FurtherEventRow = {
  event_key: string;
  message_type: string | null;
  created_on: string | null;
  data: Row;
};

/**
 * Conversation events carry no stable id in every payload shape, so the natural
 * key is derived deterministically from type + timestamp + a hash of the raw
 * data. Re-syncing the same timeline is therefore idempotent.
 */
export function normalizeEvent(row: Row, index: number): FurtherEventRow {
  const messageType = str(row, "message_type", "messageType", "type", "event_type");
  const createdOn = ts(row, "created_on", "created_at", "timestamp", "createdOn");
  const explicitId = str(row, "id", "event_id", "uuid", "pk");
  const data = (pick(row, "data", "payload") as Row) ?? row;
  const key = explicitId
    ? `id:${explicitId}`
    : `${messageType ?? "event"}|${createdOn ?? `idx${index}`}|${hash(JSON.stringify(data))}`;
  return { event_key: key.slice(0, 200), message_type: messageType, created_on: createdOn, data: row };
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
