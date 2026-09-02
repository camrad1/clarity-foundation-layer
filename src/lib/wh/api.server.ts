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

import {
  WH_API_BASE,
  WH_LOOKUP_SOURCE,
  WH_MAX_PAGES,
  type WhLookupTable,
  type WhTable,
} from "./tables";
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

async function getUrl(auth: WhAuth, url: string | URL) {
  return fetch(url, { method: "GET", headers: authHeaders(auth), redirect: "follow" });
}

async function get(auth: WhAuth, path: string, params?: Record<string, string>) {
  const url = new URL(`${WH_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return getUrl(auth, url);
}

/**
 * Reads the cursor for the next export page out of the RFC5988 `Link` header.
 * WelcomeHome ignores page/per_page — this header is the only way to advance.
 */
export function nextPageUrl(res: Response): string | null {
  const link = res.headers.get("link");
  if (!link) return null;
  const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(link);
  return match ? match[1]! : null;
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

export type WhPage = { records: Record<string, string>[]; nextUrl: string | null };

function exportPath(table: WhTable, communitySourceId: string | null): string {
  return communitySourceId
    ? `/exports/community/${encodeURIComponent(communitySourceId)}/table/${table}`
    : `/exports/table/${table}`;
}

/**
 * Fetches ONE export page and returns the cursor URL for the next one.
 *
 * `updatedAfter` still maps to filters[updated_at_after] when a caller supplies
 * it, but the exports carry no updated_at column, so callers cannot derive a
 * watermark from the response (see WH_INCREMENTAL_TABLES).
 */
export async function whExportPage(
  auth: WhAuth,
  opts: {
    table: WhTable;
    communitySourceId: string | null;
    cursorUrl?: string | null;
    updatedAfter?: string | null;
  },
): Promise<WhPage> {
  let res: Response;
  if (opts.cursorUrl) {
    res = await getUrl(auth, opts.cursorUrl);
  } else {
    const params: Record<string, string> = {};
    if (opts.updatedAfter) params["filters[updated_at_after]"] = opts.updatedAfter;
    res = await get(auth, exportPath(opts.table, opts.communitySourceId), params);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${opts.table}: unauthorized for this community`);
  }
  if (res.status === 404) {
    throw new Error(`${opts.table}: not exposed as an export table (404)`);
  }
  if (!res.ok) throw new Error(`${opts.table}: export request failed (${res.status})`);

  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let records: Record<string, string>[];
  if (contentType.includes("application/json")) {
    const json = JSON.parse(text);
    const rows: Record<string, unknown>[] = Array.isArray(json) ? json : (json.data ?? []);
    records = rows.map(flatten);
  } else {
    records = csvToRecords(text);
  }
  return { records, nextUrl: nextPageUrl(res) };
}

/** Walks every export page for a table by following the Link cursor. */
export async function whExportAll(
  auth: WhAuth,
  opts: { table: WhTable; communitySourceId: string | null; updatedAfter?: string | null },
): Promise<{ records: Record<string, string>[]; pages: number; truncated: boolean }> {
  const records: Record<string, string>[] = [];
  let cursorUrl: string | null = null;
  let pages = 0;
  for (;;) {
    const page: WhPage = await whExportPage(auth, { ...opts, cursorUrl });
    pages += 1;
    records.push(...page.records);
    if (!page.nextUrl || page.records.length === 0) {
      return { records, pages, truncated: false };
    }
    if (pages >= WH_MAX_PAGES) return { records, pages, truncated: true };
    cursorUrl = page.nextUrl;
  }
}

function flatten(r: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    flat[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return flat;
}

/**
 * Fetches a lookup dimension from whichever transport WelcomeHome actually
 * serves it on. JSON lookups are account-wide top-level endpoints; only
 * Referrers is a per-community CSV export.
 */
export async function whLookup(
  auth: WhAuth,
  table: WhLookupTable,
  communitySourceId: string | null,
): Promise<{ records: Record<string, string>[]; pages: number; transport: "json" | "export" }> {
  const source = WH_LOOKUP_SOURCE[table];
  if (source.kind === "export") {
    const { records, pages } = await whExportAll(auth, {
      table,
      communitySourceId,
    });
    return { records, pages, transport: "export" };
  }
  const res = await get(auth, `/${source.path}`);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${table}: unauthorized (${res.status})`);
  }
  if (!res.ok) throw new Error(`${table}: lookup request failed (${res.status})`);
  const json = JSON.parse(await res.text());
  const rows: Record<string, unknown>[] = Array.isArray(json) ? json : (json.data ?? []);
  return { records: rows.map(flatten), pages: 1, transport: "json" };
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
    const res = await get(auth, `/exports/daily_snapshots/table/${table}`);
    return res.ok ? "available" : "not_configured";
  } catch {
    return "not_configured";
  }
}

