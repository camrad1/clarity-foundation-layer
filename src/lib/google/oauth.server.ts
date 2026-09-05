/**
 * SERVER ONLY. Google OAuth 2.0 (authorization code + offline refresh).
 *
 * - The OAuth client id/secret are read from environment secrets inside the
 *   handler; they are never sent to the browser.
 * - Access and refresh tokens live in `google_oauth_tokens`, a table with RLS
 *   enabled and no policies, so only the service role can read them.
 * - Refresh-token rotation is supported: whenever Google returns a new refresh
 *   token it replaces the stored one.
 */

import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_SCOPES,
  isAllowedOrigin,
  type GoogleService,
} from "./config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export function googleClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured yet. Add the Google Cloud OAuth client id and secret first.",
    );
  }
  return { clientId, clientSecret };
}

export function googleOauthConfigured(): boolean {
  return Boolean(
    process.env["GOOGLE_OAUTH_CLIENT_ID"] && process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
  );
}

/**
 * The redirect URI registered in Google Cloud. A fixed override always wins so
 * production never depends on whichever origin the admin happened to use.
 */
export function resolveRedirectUri(origin?: string | null): string {
  const override = process.env["GOOGLE_OAUTH_REDIRECT_URI"];
  if (override) return override;
  if (origin && isAllowedOrigin(origin)) {
    return new URL(GOOGLE_OAUTH_CALLBACK_PATH, origin).toString();
  }
  throw new Error("No valid origin available for the Google OAuth redirect URI.");
}

export function buildAuthUrl(params: {
  service: GoogleService;
  state: string;
  redirectUri: string;
  loginHint?: string | null;
}): string {
  const { clientId } = googleClient();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES[params.service].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(
      `Google token request failed [${res.status}]: ${json.error_description ?? json.error ?? "unknown error"}`,
    );
  }
  return json;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleClient();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

/** Decodes the unverified id_token payload purely to display the account email. */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

export async function storeTokens(
  admin: any,
  connectionId: string,
  tokens: TokenResponse,
): Promise<void> {
  const patch: Record<string, unknown> = {
    connection_id: connectionId,
    access_token: tokens.access_token ?? null,
    token_type: tokens.token_type ?? null,
    access_token_expires_at: tokens.expires_in
      ? new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  // Rotation: only overwrite the refresh token when Google issued a new one.
  if (tokens.refresh_token) patch["refresh_token"] = tokens.refresh_token;
  await admin.from("google_oauth_tokens").upsert(patch, { onConflict: "connection_id" });
}

/** Returns a valid access token, refreshing (and rotating) when needed. */
export async function getAccessToken(admin: any, connectionId: string): Promise<string> {
  const { data: row } = await admin
    .from("google_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (!row) throw new Error("This Google connection is not authorized yet.");

  const expiresAt = row.access_token_expires_at ? Date.parse(row.access_token_expires_at) : 0;
  if (row.access_token && expiresAt > Date.now()) return row.access_token as string;

  if (!row.refresh_token) {
    throw new Error("Google access has expired. Reconnect the Google account.");
  }
  const { clientId, clientSecret } = googleClient();
  const refreshed = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: row.refresh_token as string,
    grant_type: "refresh_token",
  });
  await storeTokens(admin, connectionId, refreshed);
  if (!refreshed.access_token) throw new Error("Google did not return an access token.");
  return refreshed.access_token;
}

export async function revokeTokens(admin: any, connectionId: string): Promise<void> {
  const { data: row } = await admin
    .from("google_oauth_tokens")
    .select("refresh_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  const token = row?.refresh_token as string | undefined;
  if (token) {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    }).catch(() => undefined);
  }
  await admin.from("google_oauth_tokens").delete().eq("connection_id", connectionId);
}
