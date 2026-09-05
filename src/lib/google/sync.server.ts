/**
 * SERVER ONLY. Bounded, read-only pulls from the Google Search Console API and
 * the GA4 Data API.
 *
 * ADDITIVE ONLY: everything written here lands in `gsc_api_facts` /
 * `ga4_api_facts` with source_system = 'google_api'. Manual Search Console
 * imports, WelcomeHome, Further, occupancy data, and every dashboard metric are
 * left untouched. Nothing in this file deletes or rewrites existing data.
 */

const SC_QUERY_URL = (property: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
const GA4_URL = (propertyId: string) =>
  `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;

async function googlePost(url: string, accessToken: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google API request failed [${res.status}]: ${text.slice(0, 800)}`);
  }
  return text ? JSON.parse(text) : {};
}

export type ScGrain =
  | "date"
  | "query"
  | "page"
  | "query_page"
  | "device"
  | "country"
  | "search_appearance";

/** Search Console API dimensions per stored grain. `date` is always first. */
const GRAIN_DIMENSIONS: Record<ScGrain, string[]> = {
  date: ["date"],
  query: ["date", "query"],
  page: ["date", "page"],
  query_page: ["date", "query", "page"],
  device: ["date", "device"],
  country: ["date", "country"],
  search_appearance: ["date", "searchAppearance"],
};

const PAGE_SIZE = 25000;

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Fully paginated Search Analytics pull for one grain and date range. */
export async function fetchSearchAnalytics(params: {
  accessToken: string;
  property: string;
  startDate: string;
  endDate: string;
  grain: ScGrain;
  maxRows?: number;
}): Promise<{ rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>; pages: number; truncated: boolean }> {
  const dimensions = GRAIN_DIMENSIONS[params.grain];
  const maxRows = params.maxRows ?? 100000;
  const out: any[] = [];

  // Search appearance cannot be grouped with any other dimension, so it is
  // fetched one day at a time and the date is re-attached locally.
  if (params.grain === "search_appearance") {
    let pagesSa = 0;
    for (const day of eachDay(params.startDate, params.endDate)) {
      const json = await googlePost(SC_QUERY_URL(params.property), params.accessToken, {
        startDate: day,
        endDate: day,
        dimensions: ["searchAppearance"],
        rowLimit: PAGE_SIZE,
        dataState: "final",
      });
      pagesSa += 1;
      for (const row of (json.rows ?? []) as any[]) {
        out.push({ ...row, keys: [day, ...(row.keys ?? [])] });
      }
    }
    return { rows: out, pages: pagesSa, truncated: false };
  }

  let startRow = 0;
  let pages = 0;
  let truncated = false;

  for (;;) {
    const body: Record<string, unknown> = {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      rowLimit: PAGE_SIZE,
      startRow,
      dataState: "final",
    };
    const json = await googlePost(SC_QUERY_URL(params.property), params.accessToken, body);
    pages += 1;
    const rows = (json.rows ?? []) as any[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    startRow += rows.length;
    if (out.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  return { rows: out, pages, truncated };
}

function dimKey(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "").toLowerCase()).join("\u0001") || "-";
}

/** Maps a raw Search Analytics row onto the storage shape for its grain. */
export function toScFact(grain: ScGrain, keys: string[]) {
  const date = keys[0];
  const rest = keys.slice(1);
  const base = {
    grain,
    date,
    query: null as string | null,
    page: null as string | null,
    device: null as string | null,
    country: null as string | null,
    search_appearance: null as string | null,
  };
  switch (grain) {
    case "query":
      base.query = rest[0] ?? null;
      break;
    case "page":
      base.page = rest[0] ?? null;
      break;
    case "query_page":
      base.query = rest[0] ?? null;
      base.page = rest[1] ?? null;
      break;
    case "device":
      base.device = rest[0] ?? null;
      break;
    case "country":
      base.country = rest[0] ?? null;
      break;
    case "search_appearance":
      base.search_appearance = rest[0] ?? null;
      break;
    default:
      break;
  }
  return {
    ...base,
    dim_key: dimKey([base.query, base.page, base.device, base.country, base.search_appearance]),
  };
}

// ------------------------------------------------------------
// GA4
// ------------------------------------------------------------

export type Ga4Report =
  | "daily_totals"
  | "source_medium"
  | "landing_page"
  | "channel_group"
  | "device"
  | "source_medium_campaign";

/**
 * Metric set stored for every GA4 grain. Engagement rate is a ratio and is kept
 * as reported per row; it is never averaged across rows when reading.
 */
const GA4_METRICS = [
  "sessions",
  "activeUsers",
  "newUsers",
  "engagedSessions",
  "screenPageViews",
  "engagementRate",
];

/**
 * Grains stay separate on purpose. Every report is session-scoped except the
 * landing page report, and no two grains are merged into one table row.
 */
const GA4_DIMENSIONS: Record<Ga4Report, string[]> = {
  daily_totals: ["date"],
  source_medium: ["date", "sessionSourceMedium"],
  landing_page: ["date", "landingPagePlusQueryString"],
  channel_group: ["date", "sessionDefaultChannelGroup"],
  device: ["date", "deviceCategory"],
  source_medium_campaign: ["date", "sessionSource", "sessionMedium", "sessionCampaignName"],
};

const GA4_PAGE_SIZE = 100000;

/** Retries transient quota (429) and server errors with capped backoff. */
async function ga4Post(
  url: string,
  accessToken: string,
  body: unknown,
  events: { retries: number; quotaHits: number },
): Promise<any> {
  let attempt = 0;
  for (;;) {
    try {
      return await googlePost(url, accessToken, body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const quota = /\[429\]/.test(message);
      const server = /\[5\d\d\]/.test(message);
      if ((!quota && !server) || attempt >= 5) throw e;
      if (quota) events.quotaHits += 1;
      events.retries += 1;
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
    }
  }
}

/**
 * Fully paginated GA4 Data API pull for one grain and date range. Paging walks
 * `offset` until the reported `rowCount` is exhausted, so nothing is silently
 * capped.
 */
export async function fetchGa4Report(params: {
  accessToken: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  report: Ga4Report;
  limit?: number;
  maxRows?: number;
}): Promise<{
  rows: any[];
  rowCount: number;
  sampled: boolean;
  pages: number;
  timeZone: string | null;
  truncated: boolean;
  retries: number;
  quotaHits: number;
}> {
  const pageSize = params.limit ?? GA4_PAGE_SIZE;
  const maxRows = params.maxRows ?? 1_000_000;
  const events = { retries: 0, quotaHits: 0 };
  const out: any[] = [];
  let offset = 0;
  let pages = 0;
  let rowCount = 0;
  let sampled = false;
  let timeZone: string | null = null;
  let truncated = false;

  for (;;) {
    const json = await ga4Post(
      GA4_URL(params.propertyId),
      params.accessToken,
      {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: GA4_DIMENSIONS[params.report].map((name) => ({ name })),
        metrics: GA4_METRICS.map((name) => ({ name })),
        limit: pageSize,
        offset,
        orderBys: [{ dimension: { dimensionName: "date" } }],
        keepEmptyRows: false,
      },
      events,
    );
    pages += 1;
    const rows = (json.rows ?? []) as any[];
    out.push(...rows);
    rowCount = Number(json.rowCount ?? out.length);
    sampled = sampled || Boolean(json.metadata?.dataLossFromOtherRow);
    timeZone = timeZone ?? (json.metadata?.timeZone ?? null);
    offset += rows.length;
    if (rows.length === 0 || offset >= rowCount) break;
    if (out.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  return { rows: out, rowCount, sampled, pages, timeZone, truncated, retries: events.retries, quotaHits: events.quotaHits };
}

/** GA4 returns dates as YYYYMMDD. */
export function ga4Date(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Maps one GA4 row onto the storage shape for its grain. Dimension values are
 * stored verbatim (actual calendar date, landing page path, source, medium,
 * campaign, channel group, device) — nothing is normalized away.
 */
export function toGa4Fact(report: Ga4Report, row: any) {
  const dims = (row.dimensionValues ?? []).map((d: any) => d.value as string);
  const m = (row.metricValues ?? []).map((v: any) => Number(v.value ?? 0));
  const d1 = dims[1] ?? null;

  const fact = {
    report,
    date: ga4Date(dims[0] ?? ""),
    session_source_medium: null as string | null,
    session_source: null as string | null,
    session_medium: null as string | null,
    session_campaign: null as string | null,
    default_channel_group: null as string | null,
    device_category: null as string | null,
    landing_page_path: null as string | null,
  };

  switch (report) {
    case "source_medium":
      fact.session_source_medium = d1;
      break;
    case "landing_page":
      fact.landing_page_path = d1;
      break;
    case "channel_group":
      fact.default_channel_group = d1;
      break;
    case "device":
      fact.device_category = d1;
      break;
    case "source_medium_campaign":
      fact.session_source = d1;
      fact.session_medium = dims[2] ?? null;
      fact.session_campaign = dims[3] ?? null;
      fact.session_source_medium = `${d1 ?? ""} / ${dims[2] ?? ""}`;
      break;
    default:
      break;
  }

  // Case is significant: GA4 reports e.g. "Google / organic" and
  // "google / organic" as distinct dimension values, so the key is stored
  // verbatim rather than lower-cased.
  const dimKeyValue =
    report === "source_medium_campaign"
      ? [fact.session_source ?? "", fact.session_medium ?? "", fact.session_campaign ?? ""].join("\u0001")
      : (d1 ?? "-");

  return {
    ...fact,
    dim_key: dimKeyValue,
    sessions: m[0] ?? 0,
    active_users: m[1] ?? 0,
    new_users: m[2] ?? 0,
    engaged_sessions: m[3] ?? 0,
    screen_page_views: m[4] ?? 0,
    engagement_rate: Number.isFinite(m[5]) ? m[5] : null,
  };
}
