/**
 * Shared, browser-safe Google integration constants.
 *
 * Nothing secret lives here: the OAuth client id/secret and every token are
 * server-side only (see oauth.server.ts).
 */

export type GoogleService = "search_console" | "ga4";

export const GOOGLE_SERVICE_LABELS: Record<GoogleService, string> = {
  search_console: "Google Search Console",
  ga4: "Google Analytics 4",
};

/** Path Google redirects back to after the user authorizes the connection. */
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/public/google/oauth/callback";

export const GOOGLE_SCOPES: Record<GoogleService, string[]> = {
  search_console: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
  ga4: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
};

/** Origins this app is allowed to complete an OAuth round-trip on. */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" && url.hostname === "localhost") return true;
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "clarityiq.life" ||
      host === "www.clarityiq.life" ||
      host.endsWith(".lovable.app")
    );
  } catch {
    return false;
  }
}
