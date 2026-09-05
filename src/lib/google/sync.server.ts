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
    if (params.grain === "search_appearance") {
      // searchAppearance cannot be combined with other dimensions except date.
      body["dimensions"] = ["date", "searchAppearance"];
    }
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

export type Ga4Report = "daily_totals" | "source_medium" | "landing_page";

const GA4_METRICS = [
  "sessions",
  "activeUsers",
  "newUsers",
  "engagedSessions",
  "screenPageViews",
];

const GA4_DIMENSIONS: Record<Ga4Report, string[]> = {
  daily_totals: ["date"],
  source_medium: ["date", "sessionSourceMedium"],
  landing_page: ["date", "landingPagePlusQueryString"],
};

export async function fetchGa4Report(params: {
  accessToken: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  report: Ga4Report;
  limit?: number;
}): Promise<{ rows: any[]; rowCount: number; sampled: boolean }> {
  const json = await googlePost(GA4_URL(params.propertyId), params.accessToken, {
    dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
    dimensions: GA4_DIMENSIONS[params.report].map((name) => ({ name })),
    metrics: GA4_METRICS.map((name) => ({ name })),
    limit: params.limit ?? 250,
    orderBys:
      params.report === "daily_totals"
        ? [{ dimension: { dimensionName: "date" } }]
        : [{ metric: { metricName: "sessions" }, desc: true }],
    keepEmptyRows: false,
  });
  return {
    rows: (json.rows ?? []) as any[],
    rowCount: Number(json.rowCount ?? (json.rows?.length ?? 0)),
    sampled: Boolean(json.metadata?.dataLossFromOtherRow),
  };
}

/** GA4 returns dates as YYYYMMDD. */
export function ga4Date(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function toGa4Fact(report: Ga4Report, row: any) {
  const dims = (row.dimensionValues ?? []).map((d: any) => d.value as string);
  const m = (row.metricValues ?? []).map((v: any) => Number(v.value ?? 0));
  const secondary = dims[1] ?? null;
  return {
    report,
    date: ga4Date(dims[0] ?? ""),
    session_source_medium: report === "source_medium" ? secondary : null,
    landing_page_path: report === "landing_page" ? secondary : null,
    dim_key: (secondary ?? "-").toLowerCase(),
    sessions: m[0] ?? 0,
    active_users: m[1] ?? 0,
    new_users: m[2] ?? 0,
    engaged_sessions: m[3] ?? 0,
    screen_page_views: m[4] ?? 0,
  };
}
