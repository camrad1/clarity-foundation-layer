/**
 * SERVER ONLY. Read-only Google Ads API client.
 *
 * GUARDRAILS
 * ----------
 * - Every call here is a GAQL *read*. There is no mutate endpoint anywhere in
 *   this file, so the app cannot create, edit, pause or budget anything.
 * - The developer token, OAuth client secret and refresh token never leave the
 *   server and are never returned to the browser.
 * - Nothing written from these results is canonical; it lands only in
 *   `google_ads_api_facts`.
 */

const BASE = "https://googleads.googleapis.com";
/** Newest first. The first version the API accepts is cached for the process. */
const VERSIONS = ["v25", "v24", "v23", "v22"];
let cachedVersion: string | null = null;

export function adsDeveloperToken(): string {
  const token = process.env["GOOGLE_ADS_DEVELOPER_TOKEN"];
  if (!token) {
    throw new Error(
      "The Google Ads developer token has not been saved yet. Add GOOGLE_ADS_DEVELOPER_TOKEN first.",
    );
  }
  return token;
}

export function adsDeveloperTokenConfigured(): boolean {
  return Boolean(process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]);
}

/** Masked hint only — never the value. */
export function maskedTokenHint(): string | null {
  const token = process.env["GOOGLE_ADS_DEVELOPER_TOKEN"];
  if (!token) return null;
  return `${token.slice(0, 3)}${"•".repeat(Math.max(4, token.length - 5))}${token.slice(-2)}`;
}

export function digitsOnly(customerId: string): string {
  return customerId.replace(/\D/g, "");
}

function headers(loginCustomerId?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "developer-token": adsDeveloperToken(),
    "Content-Type": "application/json",
  };
  const login = loginCustomerId ? digitsOnly(loginCustomerId) : "";
  if (login) h["login-customer-id"] = login;
  return h;
}

async function call(
  version: string,
  path: string,
  accessToken: string,
  init: { method: "GET" | "POST"; body?: unknown; loginCustomerId?: string | null },
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(`${BASE}/${version}/${path}`, {
    method: init.method,
    headers: { ...headers(init.loginCustomerId), Authorization: `Bearer ${accessToken}` },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Runs a request, discovering a supported API version on the first failure. */
async function request(
  path: string,
  accessToken: string,
  init: { method: "GET" | "POST"; body?: unknown; loginCustomerId?: string | null },
): Promise<any> {
  const order = cachedVersion ? [cachedVersion, ...VERSIONS.filter((v) => v !== cachedVersion)] : VERSIONS;
  let last: { status: number; text: string } | null = null;
  for (const version of order) {
    const res = await call(version, path, accessToken, init);
    if (res.ok) {
      cachedVersion = version;
      return res.json ?? {};
    }
    last = { status: res.status, text: res.text };
    // Only an unknown-version error is worth retrying on another version.
    const versionProblem = res.status === 404 || /Unknown|not found|invalid version/i.test(res.text);
    if (!versionProblem) break;
  }
  throw new Error(
    `Google Ads API request failed [${last?.status ?? "?"}]: ${(last?.text ?? "").slice(0, 900)}`,
  );
}

export function adsApiVersion(): string {
  return cachedVersion ?? VERSIONS[0]!;
}

/** Paginated GAQL search. Read-only by construction. */
export async function gaql(params: {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string | null;
  query: string;
  maxRows?: number;
}): Promise<any[]> {
  const cid = digitsOnly(params.customerId);
  const maxRows = params.maxRows ?? 50000;
  const rows: any[] = [];
  let pageToken: string | undefined;
  do {
    const json = await request(`customers/${cid}/googleAds:search`, params.accessToken, {
      method: "POST",
      loginCustomerId: params.loginCustomerId ?? null,
      // page_size is not accepted by current Google Ads API versions.
      body: { query: params.query, ...(pageToken ? { pageToken } : {}) },
    });
    rows.push(...((json.results ?? []) as any[]));
    pageToken = json.nextPageToken;
  } while (pageToken && rows.length < maxRows);
  return rows;
}

export type AdsAccount = {
  customerId: string;
  descriptiveName: string | null;
  manager: boolean;
  testAccount: boolean;
  currencyCode: string | null;
  timeZone: string | null;
  status: string | null;
  level: number | null;
  viaManagerId: string | null;
};

/** Customer IDs the authorized Google user can reach directly. */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const json = await request("customers:listAccessibleCustomers", accessToken, { method: "GET" });
  return ((json.resourceNames ?? []) as string[]).map((n) => n.replace("customers/", ""));
}

/** Every account under one accessible customer, including the customer itself. */
export async function listCustomerClients(
  accessToken: string,
  customerId: string,
): Promise<AdsAccount[]> {
  const rows = await gaql({
    accessToken,
    customerId,
    loginCustomerId: customerId,
    query: `
      SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
             customer_client.test_account, customer_client.currency_code, customer_client.time_zone,
             customer_client.status, customer_client.level
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
    `,
  });
  return rows.map((r) => {
    const c = r.customerClient ?? {};
    return {
      customerId: String(c.id ?? ""),
      descriptiveName: c.descriptiveName ?? null,
      manager: Boolean(c.manager),
      testAccount: Boolean(c.testAccount),
      currencyCode: c.currencyCode ?? null,
      timeZone: c.timeZone ?? null,
      status: c.status ?? null,
      level: c.level != null ? Number(c.level) : null,
      viaManagerId: digitsOnly(customerId),
    };
  });
}

/** Account metadata for the selected client account. */
export async function fetchCustomer(params: {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string | null;
}): Promise<{
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  manager: boolean;
  testAccount: boolean;
}> {
  const rows = await gaql({
    ...params,
    query: `
      SELECT customer.id, customer.descriptive_name, customer.currency_code,
             customer.time_zone, customer.manager, customer.test_account
      FROM customer
      LIMIT 1
    `,
  });
  const c = rows[0]?.customer ?? {};
  return {
    customerId: String(c.id ?? digitsOnly(params.customerId)),
    descriptiveName: c.descriptiveName ?? null,
    currencyCode: c.currencyCode ?? null,
    timeZone: c.timeZone ?? null,
    manager: Boolean(c.manager),
    testAccount: Boolean(c.testAccount),
  };
}

// ------------------------------------------------------------
// Dates: always the Google Ads account's own calendar dates.
// ------------------------------------------------------------

/** Today in the account's reporting timezone, as a plain calendar date. */
export function todayInTimeZone(timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Latest complete window: ends yesterday in account time, never the partial today. */
export function completeWindow(timeZone: string | null, days: number): { start: string; end: string } {
  const end = shiftDate(todayInTimeZone(timeZone), -1);
  return { start: shiftDate(end, -(days - 1)), end };
}

// ------------------------------------------------------------
// Report grains. Each stays a separate grain; nothing is combined.
// ------------------------------------------------------------

const METRICS =
  "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value";

export const ADS_QUERIES = {
  account_day: (s: string, e: string) => `
    SELECT segments.date, ${METRICS}
    FROM customer
    WHERE segments.date BETWEEN '${s}' AND '${e}'
  `,
  campaign_day: (s: string, e: string) => `
    SELECT segments.date, campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type, ${METRICS}
    FROM campaign
    WHERE segments.date BETWEEN '${s}' AND '${e}'
  `,
  device_day: (s: string, e: string) => `
    SELECT segments.date, segments.device, ${METRICS}
    FROM customer
    WHERE segments.date BETWEEN '${s}' AND '${e}'
  `,
  ad_group_day: (s: string, e: string) => `
    SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ${METRICS}
    FROM ad_group
    WHERE segments.date BETWEEN '${s}' AND '${e}'
  `,
  /**
   * Conversion metrics only. Segmenting by conversion action makes non-conversion
   * metrics invalid, so impressions/clicks/cost are deliberately absent here.
   */
  conversion_action_day: (s: string, e: string) => `
    SELECT segments.date, segments.conversion_action, segments.conversion_action_name,
           segments.conversion_action_category, metrics.all_conversions,
           metrics.all_conversions_value, metrics.conversions, metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${s}' AND '${e}'
  `,
} as const;

export type AdsGrain = keyof typeof ADS_QUERIES;

/** Conversion action configuration, used to explain what "Conversions" means. */
export async function fetchConversionActions(params: {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string | null;
}): Promise<
  Array<{
    id: string;
    name: string | null;
    category: string | null;
    type: string | null;
    status: string | null;
    primaryForGoal: boolean | null;
    countingType: string | null;
  }>
> {
  const rows = await gaql({
    ...params,
    query: `
      SELECT conversion_action.id, conversion_action.name, conversion_action.category,
             conversion_action.type, conversion_action.status,
             conversion_action.primary_for_goal, conversion_action.counting_type
      FROM conversion_action
    `,
  });
  return rows.map((r) => {
    const a = r.conversionAction ?? {};
    return {
      id: String(a.id ?? ""),
      name: a.name ?? null,
      category: a.category ?? null,
      type: a.type ?? null,
      status: a.status ?? null,
      primaryForGoal: a.primaryForGoal == null ? null : Boolean(a.primaryForGoal),
      countingType: a.countingType ?? null,
    };
  });
}

const MICROS = 1_000_000;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Maps one API row onto the storage shape for its grain.
 * Cost is stored as raw micros (audit source) AND as currency units derived by
 * Google's documented divide-by-1,000,000 rule — the micros are never lost.
 */
export function toAdsFact(grain: AdsGrain, row: any) {
  const m = row.metrics ?? {};
  const seg = row.segments ?? {};
  const campaign = row.campaign ?? {};
  const adGroup = row.adGroup ?? {};

  const costMicros = num(m.costMicros);
  const avgCpcMicros = m.averageCpc == null ? null : num(m.averageCpc);

  const base = {
    grain,
    date: seg.date as string,
    campaign_id: campaign.id != null ? String(campaign.id) : null,
    campaign_name: campaign.name ?? null,
    campaign_status: campaign.status ?? null,
    advertising_channel_type: campaign.advertisingChannelType ?? null,
    ad_group_id: adGroup.id != null ? String(adGroup.id) : null,
    ad_group_name: adGroup.name ?? null,
    device: seg.device ?? null,
    conversion_action_id: seg.conversionAction
      ? String(seg.conversionAction).split("/").pop() ?? null
      : null,
    conversion_action_name: seg.conversionActionName ?? null,
    conversion_action_category: seg.conversionActionCategory ?? null,
    impressions: Math.round(num(m.impressions)),
    clicks: Math.round(num(m.clicks)),
    cost_micros: Math.round(costMicros),
    cost: costMicros / MICROS,
    ctr: m.ctr == null ? null : num(m.ctr),
    average_cpc_micros: avgCpcMicros == null ? null : Math.round(avgCpcMicros),
    average_cpc: avgCpcMicros == null ? null : avgCpcMicros / MICROS,
    conversions: num(m.conversions),
    conversions_value: num(m.conversionsValue),
  };

  const dimKey =
    grain === "account_day"
      ? "-"
      : grain === "campaign_day"
        ? (base.campaign_id ?? "-")
        : grain === "device_day"
          ? (base.device ?? "-")
          : grain === "ad_group_day"
            ? `${base.campaign_id ?? ""}\u0001${base.ad_group_id ?? ""}`
            : (base.conversion_action_id ?? base.conversion_action_name ?? "-");

  return { ...base, dim_key: dimKey };
}

/** All-conversions figures kept alongside the primary Conversions column. */
export function allConversions(row: any): { allConversions: number; allConversionsValue: number } {
  const m = row.metrics ?? {};
  return {
    allConversions: num(m.allConversions),
    allConversionsValue: num(m.allConversionsValue),
  };
}
