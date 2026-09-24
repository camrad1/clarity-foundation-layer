import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/clarity/app-shell";
import { Button } from "@/components/ui/button";
import {
  clearChunkReloadFlag,
  errorMessage,
  isChunkLoadError,
  isTransientNetworkError,
  logNavFailure,
  logNavRecovery,
  reloadOnceForChunkError,
} from "@/lib/nav-diagnostics";

/**
 * Auth gate.
 *
 * The gate must only redirect when the visitor is *definitively* signed out.
 * A transient network failure on the auth check used to throw out of
 * `beforeLoad`, which the root error boundary turned into the fatal
 * "This page didn't load" screen on an otherwise valid route.
 */
async function resolveUser(path: string) {
  // Local (no network) session read first: this is what makes navigation
  // resilient while the auth service is briefly unreachable.
  const { data: sessionData } = await supabase.auth.getSession();
  const cachedUser = sessionData.session?.user ?? null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (data?.user) {
        if (attempt > 1) {
          logNavRecovery({ path, phase: "auth_gate", attempt, detail: "auth check retry" });
        }
        return { user: data.user, degraded: false };
      }
      if (error && isTransientNetworkError(error)) {
        if (attempt === 1) continue;
        logNavFailure(error, {
          path,
          phase: "auth_gate",
          attempt,
          authReady: Boolean(cachedUser),
          retrySucceeded: false,
        });
        break;
      }
      return { user: null, degraded: false };
    } catch (error) {
      if (attempt === 1 && isTransientNetworkError(error)) continue;
      logNavFailure(error, {
        path,
        phase: "auth_gate",
        attempt,
        authReady: Boolean(cachedUser),
        retrySucceeded: false,
      });
      break;
    }
  }

  // Auth service unreachable: fall back to the cached session instead of
  // bouncing a signed-in user to /auth or crashing the route.
  return { user: cachedUser, degraded: Boolean(cachedUser) };
}

/**
 * A deactivated account keeps a valid token until it expires, and row level
 * security already returns nothing for it. Signing it out here means the person
 * sees the sign-in screen instead of an app full of empty pages.
 */
async function isDeactivated(userId: string) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();
    return data ? data.is_active === false : false;
  } catch {
    return false;
  }
}

/**
 * An emailed sign-in link authenticates, but never authorizes: a person with
 * no organization membership is signed out. Lookup failures fail open (row
 * level security still returns nothing) so transient errors don't lock
 * members out.
 */
async function hasNoMembership(userId: string) {
  try {
    const { data, error } = await supabase
      .from("organization_memberships")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length === 0;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { user } = await resolveUser(location.pathname);
    if (!user) throw redirect({ to: "/auth" });
    if ((await isDeactivated(user.id)) || (await hasNoMembership(user.id))) {
      await supabase.auth.signOut();
      try {
        sessionStorage.setItem("clarity:no-access", "1");
      } catch {
        /* ignore */
      }
      throw redirect({ to: "/auth" });
    }
    return { user };
  },
  component: AuthenticatedLayout,
  pendingComponent: AuthenticatedPending,
  errorComponent: AuthenticatedError,
});

function AuthenticatedLayout() {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  useEffect(() => {
    clearChunkReloadFlag(path);
  }, [path]);

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AuthenticatedPending() {
  return (
    <AppShell>
      <div className="space-y-4 p-6">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    </AppShell>
  );
}

/**
 * Errors from any page inside the shell land here instead of the root fatal
 * screen: the sidebar stays usable and retry is localized to the page.
 */
function AuthenticatedError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const path = typeof window === "undefined" ? "" : window.location.pathname;

  useEffect(() => {
    logNavFailure(error, { path, phase: "route_render" });
    if (isChunkLoadError(error)) reloadOnceForChunkError(path);
  }, [error, path]);

  const transient = isTransientNetworkError(error) || isChunkLoadError(error);

  return (
    <AppShell>
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {transient ? "This page couldn't finish loading" : "Something went wrong on this page"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {transient
              ? "The connection dropped while loading this page's data. Your other pages are unaffected."
              : "The rest of the app is still available in the left menu."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground/80">{errorMessage(error).slice(0, 180)}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button
              onClick={() => {
                logNavRecovery({ path, phase: "route_render", detail: "manual retry" });
                void router.invalidate();
                reset();
              }}
            >
              <RefreshCw className="size-4" />
              Retry this page
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
