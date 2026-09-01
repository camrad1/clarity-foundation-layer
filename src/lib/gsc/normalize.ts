/**
 * Deterministic normalization for Search Console imports.
 *
 * Original text is always preserved on the fact row; these helpers only build
 * the *comparison key* used for matching across exports and for URL mapping.
 * Nothing here may change the meaning of a query or a URL.
 */

/** Normalized query key: trimmed, whitespace collapsed, lower cased. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Tracking parameters that never identify a distinct page. */
const TRACKING_PARAMS = /^(utm_|gclid$|fbclid$|msclkid$|mc_cid$|mc_eid$|_ga$)/i;

/**
 * Normalized URL key: lower-cased scheme/host, tracking parameters removed,
 * fragment removed, trailing slash removed except on the root path. Meaningful
 * query strings are preserved — they can be genuinely distinct pages.
 */
export function normalizeUrl(raw: string): string {
  const input = raw.trim();
  try {
    const url = new URL(input);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    url.hash = "";
    const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
    url.search = "";
    if (params.length) {
      params.sort(([a], [b]) => a.localeCompare(b));
      url.search = new URLSearchParams(params).toString();
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return input.replace(/#.*$/, "").replace(/(.)\/+$/, "$1").toLowerCase();
  }
}

/** Short, human readable label for a page URL (path only). */
export function pageLabel(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname === "/" ? "/ (home)" : u.pathname;
  } catch {
    return raw;
  }
}

/** SHA-256 of the uploaded file bytes — the idempotency key for imports. */
export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
