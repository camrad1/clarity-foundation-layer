/**
 * SERVER ONLY. Read-only Google API calls used by the connection pages.
 * Nothing here writes to Google, and no credential ever leaves the server.
 */

export type SearchConsoleProperty = {
  siteUrl: string;
  permissionLevel: string;
  propertyType: "Domain property" | "URL prefix property";
};

export type Ga4Property = {
  propertyId: string;
  displayName: string;
  accountName: string | null;
  timeZone: string | null;
  currencyCode: string | null;
};

async function googleGet(url: string, accessToken: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google API request failed [${res.status}]: ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Verified Search Console properties the authorized account can read. */
export async function listSearchConsoleProperties(
  accessToken: string,
): Promise<SearchConsoleProperty[]> {
  const json = await googleGet(
    "https://searchconsole.googleapis.com/webmasters/v3/sites",
    accessToken,
  );
  const entries = (json.siteEntry ?? []) as Array<{ siteUrl: string; permissionLevel?: string }>;
  return entries
    .filter((e) => e.permissionLevel !== "siteUnverifiedUser")
    .map((e) => ({
      siteUrl: e.siteUrl,
      permissionLevel: e.permissionLevel ?? "unknown",
      propertyType: e.siteUrl.startsWith("sc-domain:")
        ? ("Domain property" as const)
        : ("URL prefix property" as const),
    }));
}

/** GA4 properties across every account the authorized user can access. */
export async function listGa4Properties(accessToken: string): Promise<Ga4Property[]> {
  const accounts: Array<{ name: string; displayName: string }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accounts");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = await googleGet(url.toString(), accessToken);
    accounts.push(...((json.accounts ?? []) as Array<{ name: string; displayName: string }>));
    pageToken = json.nextPageToken;
  } while (pageToken);

  const properties: Ga4Property[] = [];
  for (const account of accounts) {
    let token: string | undefined;
    do {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/properties");
      url.searchParams.set("filter", `parent:${account.name}`);
      url.searchParams.set("pageSize", "200");
      if (token) url.searchParams.set("pageToken", token);
      const json = await googleGet(url.toString(), accessToken);
      for (const p of (json.properties ?? []) as Array<{
        name: string;
        displayName: string;
        timeZone?: string;
        currencyCode?: string;
      }>) {
        properties.push({
          propertyId: p.name.replace(/^properties\//, ""),
          displayName: p.displayName,
          accountName: account.displayName ?? null,
          timeZone: p.timeZone ?? null,
          currencyCode: p.currencyCode ?? null,
        });
      }
      token = json.nextPageToken;
    } while (token);
  }
  return properties.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
