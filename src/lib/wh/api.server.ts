/**
 * WelcomeHome API client — SERVER ONLY.
 *
 * The API token never leaves the server: it is read from
 * data_source_credentials (a table with no RLS policies, reachable only by the
 * service role) and injected into the Authorization header here. It is never
 * returned to the browser, never logged, and never stored in a table any
 * signed-in user can select from.
 *
 * WelcomeHome is read-only for ClarityIQ. Only GET requests are issued.
 */

import { WH_API_BASE, WH_MAX_PAGE_SIZE, type WhTable } from "./tables";
import { csvToRecords } from "./csv.server";

export type WhAuth = { token: string };

function authHeaders(auth: WhAuth): HeadersInit {
  return {
    Authorization: `Token token=${auth.token}`,
    Accept: "text/csv, application/json",
  };
}

/** Redacts anything token-shaped before an error reaches a log or the UI. */
export function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/Token\s+token=[^\s,;]+/gi, "Token token=[redacted]").slice(0, 500);
}

async function get(auth: WhAuth, path: string, params?: Record<string, string>) {
  const url = new URL(`${WH_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { method: "GET", headers: authHeaders(auth), redirect: "follow" });
  return res;
}

/** GET /api/ping — connection test. Returns success plus a safe message. */
export async function whPing(auth: WhAuth): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await get(auth, "/ping");
    const body = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "WelcomeHome rejected the token (unauthorized)." };
    }
    if (!res.ok) return { ok: false, message: `WelcomeHome responded ${res.status}.` };
    return { ok: true, message: body || "pong" };
  } catch (err) {
    return { ok: false, message: safeError(err) };
  }
}

export type WhCommunity = { source_id: string; name: string | null; payload: Record<string, unknown> };

/** GET /api/communities — discovery for community mapping. */
export async function whCommunities(auth: WhAuth): Promise<WhCommunity[]> {
  const res = await get(auth, "/communities");
  if (!res.ok) throw new Error(`communities request failed (${res.status})`);
  const text = await res.text();
  let list: Record<string, unknown>[];
  try {
    const json = JSON.parse(text);
    list = Array.isArray(json) ? json : (json.communities ?? json.data ?? []);
  } catch {
    list = csvToRecords(text);
  }
  return list
    .map((c) => {
      const id = c["id"] ?? c["community_id"] ?? c["source_id"];
      return {
        source_id: id == null ? "" : String(id),
        name: (c["name"] ?? c["community_name"] ?? null) as string | null,
        payload: c,
      };
    })
    .filter((c) => c.source_id !== "");
}

export type WhPage = { records: Record<string, string>[]; count: number };

/**
 * GET /exports/community/{community_id}/table/{table}
 *
 * Pagination uses page/per_page with the maximum safe page size to minimize
 * API calls. `updatedAfter` maps to filters[updated_at_after] for incremental
 * synchronization.
 */
export async function whExportPage(
  auth: WhAuth,
  opts: {
    table: WhTable;
    communitySourceId: string | null;
    page: number;
    perPage?: number;
    updatedAfter?: string | null;
  },
): Promise<WhPage> {
  const perPage = Math.min(opts.perPage ?? WH_MAX_PAGE_SIZE, WH_MAX_PAGE_SIZE);
  const path = opts.communitySourceId
    ? `/exports/community/${encodeURIComponent(opts.communitySourceId)}/table/${opts.table}`
    : `/exports/table/${opts.table}`;
  const params: Record<string, string> = {
    page: String(opts.page),
    per_page: String(perPage),
  };
  if (opts.updatedAfter) params["filters[updated_at_after]"] = opts.updatedAfter;

  const res = await get(auth, path, params);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${opts.table}: unauthorized for this community`);
  }
  if (!res.ok) throw new Error(`${opts.table}: export request failed (${res.status})`);
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = JSON.parse(text);
    const rows: Record<string, unknown>[] = Array.isArray(json) ? json : (json.data ?? []);
    const records = rows.map((r) => {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        flat[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      }
      return flat;
    });
    return { records, count: records.length };
  }
  const records = csvToRecords(text);
  return { records, count: records.length };
}

/**
 * Probes /exports/daily_snapshots/table/{table} without ingesting anything.
 * Daily Snapshots are optional in Phase 2; this only reports availability so
 * the architecture is ready when WelcomeHome enables them.
 */
export async function whDailySnapshotState(
  auth: WhAuth,
  table = "HousingContracts",
): Promise<"available" | "not_configured"> {
  try {
    const res = await get(auth, `/exports/daily_snapshots/table/${table}`, { per_page: "1" });
    return res.ok ? "available" : "not_configured";
  } catch {
    return "not_configured";
  }
}
