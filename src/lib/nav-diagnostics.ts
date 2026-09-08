import { reportLovableError } from "./lovable-error-reporting";

/**
 * Navigation reliability diagnostics.
 *
 * Nothing here touches metrics, data definitions, permissions, filters or
 * source integrations. It only records *why* a route transition failed so the
 * intermittent "This page didn't load" screen can be traced.
 */

export type NavFailureContext = {
  path: string;
  phase: "auth_gate" | "route_render" | "route_load";
  component?: string;
  authReady?: boolean;
  orgReady?: boolean;
  communityReady?: boolean;
  attempt?: number;
  retrySucceeded?: boolean;
};

const CHUNK_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "unable to preload css",
  "loading chunk",
];

export function isChunkLoadError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return CHUNK_PATTERNS.some((p) => message.includes(p));
}

export function isTransientNetworkError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const status = errorStatus(error);
  if (status && (status === 408 || status === 429 || status >= 500)) return true;
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("fetch failed")
  );
}

export function errorMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in (error as Record<string, unknown>)) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

export function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const raw = candidate.status ?? candidate.statusCode;
    if (typeof raw === "number") return raw;
  }
  return undefined;
}

/** Endpoint/RPC name without query strings, ids or tokens. */
export function safeEndpoint(error: unknown): string | undefined {
  const message = errorMessage(error);
  const match = message.match(/\/(rest|rpc|auth|api)\/[a-zA-Z0-9/_-]+/);
  return match?.[0];
}

export function logNavFailure(error: unknown, context: NavFailureContext) {
  const payload = {
    scope: "navigation",
    path: context.path,
    phase: context.phase,
    component: context.component,
    message: errorMessage(error).slice(0, 300),
    status: errorStatus(error),
    endpoint: safeEndpoint(error),
    chunkLoadError: isChunkLoadError(error),
    transient: isTransientNetworkError(error),
    authReady: context.authReady,
    orgReady: context.orgReady,
    communityReady: context.communityReady,
    attempt: context.attempt,
    retrySucceeded: context.retrySucceeded,
  };
  console.error("[nav-failure]", payload);
  reportLovableError(error, payload);
}

export function logNavRecovery(context: NavFailureContext & { detail?: string }) {
  console.warn("[nav-recovered]", {
    scope: "navigation",
    path: context.path,
    phase: context.phase,
    attempt: context.attempt,
    retrySucceeded: true,
    detail: context.detail,
  });
}

/**
 * A stale deployment leaves the browser holding hashed chunk URLs that no
 * longer exist. One reload (guarded so it can never loop) recovers it.
 */
export function reloadOnceForChunkError(path: string): boolean {
  if (typeof window === "undefined") return false;
  const key = `nav:chunk-reload:${path}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function clearChunkReloadFlag(path: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`nav:chunk-reload:${path}`);
  } catch {
    /* storage unavailable */
  }
}
