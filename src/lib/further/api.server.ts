/**
 * Further Public API client — SERVER ONLY.
 *
 * The organization API key never leaves the server: it is read from
 * data_source_credentials (a table with no RLS policies, reachable only by the
 * service role) and injected into the Authorization header here. It is never
 * returned to the browser, never logged, and never stored anywhere a signed-in
 * user can select from.
 *
 * Further is READ-ONLY for ClarityIQ. Only GET requests are issued.
 *
 * Auth format: `Authorization: Org-Api-Key <key>`
 * Rate limit: 300 requests/minute per key; 429 responses honour Retry-After.
 */

import {
  FURTHER_API_BASE,
  FURTHER_RATE_LIMIT_PER_MINUTE,
} from "./tables";

export type FurtherAuth = { key: string };

/** Redacts anything key-shaped before an error reaches a log or the UI. */
export function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/Org-Api-Key\s+[^\s,;"']+/gi, "Org-Api-Key [redacted]")
    .replace(/frth[_a-z0-9]*[A-Za-z0-9]{8,}/g, "[redacted]")
    .slice(0, 500);
}

/** Masked form of a key for display: never more than the last 4 characters. */
export function maskKey(key: string): string {
  const tail = key.slice(-4);
  const prefix = /^([a-z]+_[a-z]+_)/i.exec(key)?.[1] ?? "";
  return `${prefix}${"\u2022".repeat(12)}${tail}`;
}

/**
 * Minimum spacing between requests so a long sync can never exceed Further's
 * published per-key budget, even when several units run back to back.
 */
const MIN_INTERVAL_MS = Math.ceil(60_000 / FURTHER_RATE_LIMIT_PER_MINUTE) + 5;
let nextAllowedAt = 0;

async function pace() {
  const now = Date.now();
  const wait = nextAllowedAt - now;
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class FurtherHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function describe(status: number, path: string): string {
  if (status === 401) return `Further rejected the organization API key (401) on ${path}.`;
  if (status === 403) return `The API key lacks permission for ${path} (403).`;
  if (status === 404) return `Further does not expose ${path} for this key (404).`;
  if (status === 429) return `Further rate limit reached on ${path} (429).`;
  return `Further responded ${status} on ${path}.`;
}

/** One GET with pacing plus bounded 429/5xx retries honouring Retry-After. */
export async function furtherGet(
  auth: FurtherAuth,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<unknown> {
  const url = new URL(path.startsWith("http") ? path : `${FURTHER_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let attempt = 0;
  for (;;) {
    await pace();
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Org-Api-Key ${auth.key}`,
        Accept: "application/json",
      },
      redirect: "follow",
    });

    if (res.status === 429 || res.status >= 500) {
      attempt += 1;
      if (attempt > 3) throw new FurtherHttpError(res.status, describe(res.status, path));
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : Math.min(2000 * attempt, 15_000);
      // Push the whole pacing window out so sibling calls back off too.
      nextAllowedAt = Date.now() + waitMs;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) throw new FurtherHttpError(res.status, describe(res.status, path));

    const text = await res.text();
    if (!text.trim()) return [];
    try {
      return JSON.parse(text);
    } catch {
      throw new FurtherHttpError(res.status, `Further returned a non-JSON body on ${path}.`);
    }
  }
}

export type Row = Record<string, unknown>;

/** Extracts the record array from whichever envelope Further uses. */
export function rowsOf(body: unknown): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["results", "data", "leads", "visitors", "communities", "items", "events", "timeline", "messages"]) {
      const v = o[key];
      if (Array.isArray(v)) return v as Row[];
    }
  }
  return [];
}

/** Absolute URL of the next page, when the response carries a cursor. */
export function nextPageOf(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    const next = o["next"] ?? o["next_page"] ?? o["next_url"];
    if (typeof next === "string" && next) return next;
  }
  return null;
}

/**
 * Walks pages for a list endpoint. Uses the response cursor when present and
 * falls back to an incrementing `page` parameter otherwise. Bounded by
 * `maxPages` so a single work unit stays short.
 */
export async function furtherPaged(
  auth: FurtherAuth,
  path: string,
  params: Record<string, string | number | undefined>,
  opts: { maxPages: number; pageSize?: number; onPage?: (rows: Row[], page: number) => Promise<void> },
): Promise<{ rows: Row[]; pages: number; truncated: boolean }> {
  const all: Row[] = [];
  let pages = 0;
  let cursor: string | null = null;

  for (;;) {
    const body: unknown = cursor
      ? await furtherGet(auth, cursor)
      : await furtherGet(auth, path, {
          ...params,
          ...(opts.pageSize ? { page_size: opts.pageSize, limit: opts.pageSize } : {}),
          ...(pages > 0 ? { page: pages + 1 } : {}),
        });

    const rows = rowsOf(body);
    pages += 1;
    all.push(...rows);
    if (opts.onPage) await opts.onPage(rows, pages);

    const next = nextPageOf(body);
    if (rows.length === 0) return { rows: all, pages, truncated: false };
    if (pages >= opts.maxPages) return { rows: all, pages, truncated: true };
    if (next) {
      cursor = next;
      continue;
    }
    // No cursor: only keep paging when the page looks full.
    if (!opts.pageSize || rows.length < opts.pageSize) {
      return { rows: all, pages, truncated: false };
    }
    cursor = null;
  }
}

/** GET /api/v1/communities — connection test + discovery. */
export async function furtherCommunities(auth: FurtherAuth): Promise<Row[]> {
  const body = await furtherGet(auth, "/api/v1/communities");
  return rowsOf(body);
}

export type TestResult = {
  ok: boolean;
  status: number | null;
  communities: number;
  message: string;
};

/** Verifies key validity, permissions and account accessibility. */
export async function furtherTest(auth: FurtherAuth): Promise<TestResult> {
  try {
    const rows = await furtherCommunities(auth);
    return {
      ok: true,
      status: 200,
      communities: rows.length,
      message: `Connected to Further — ${rows.length} accessible ${rows.length === 1 ? "community" : "communities"}.`,
    };
  } catch (err) {
    const status = err instanceof FurtherHttpError ? err.status : null;
    return { ok: false, status, communities: 0, message: safeError(err) };
  }
}

/** GET /api/v1/leads/ — incremental by updated date when a window is given. */
export async function furtherLeadsPage(
  auth: FurtherAuth,
  opts: {
    updatedStart?: string | null;
    updatedEnd?: string | null;
    page?: number;
    pageSize?: number;
  },
): Promise<{ rows: Row[]; next: string | null }> {
  const body = await furtherGet(auth, "/api/v1/leads/", {
    updated_start_date: opts.updatedStart ?? undefined,
    updated_end_date: opts.updatedEnd ?? undefined,
    page: opts.page && opts.page > 1 ? opts.page : undefined,
    page_size: opts.pageSize,
  });
  return { rows: rowsOf(body), next: nextPageOf(body) };
}

/** GET /api/v1/leads/{id} — detail record for one lead. */
export async function furtherLeadDetail(auth: FurtherAuth, leadId: string): Promise<Row | null> {
  const body = await furtherGet(auth, `/api/v1/leads/${encodeURIComponent(leadId)}`);
  if (Array.isArray(body)) return (body[0] as Row) ?? null;
  return (body as Row) ?? null;
}

/** GET /api/v1/conversations/leads/{id} — conversation timeline for one lead. */
export async function furtherConversation(auth: FurtherAuth, leadId: string): Promise<Row[]> {
  const body = await furtherGet(
    auth,
    `/api/v1/conversations/leads/${encodeURIComponent(leadId)}`,
  );
  const rows = rowsOf(body);
  if (rows.length) return rows;
  // Some payloads nest the timeline one level down.
  if (body && typeof body === "object") {
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Row[];
    }
  }
  return [];
}

/** GET /api/v1/visitors — visitor records, optionally windowed by date. */
export async function furtherVisitors(
  auth: FurtherAuth,
  opts: { start?: string | null; end?: string | null; maxPages: number; pageSize?: number },
): Promise<{ rows: Row[]; pages: number; truncated: boolean }> {
  return furtherPaged(
    auth,
    "/api/v1/visitors",
    {
      start_date: opts.start ?? undefined,
      end_date: opts.end ?? undefined,
      updated_start_date: opts.start ?? undefined,
    },
    { maxPages: opts.maxPages, pageSize: opts.pageSize ?? 200 },
  );
}
