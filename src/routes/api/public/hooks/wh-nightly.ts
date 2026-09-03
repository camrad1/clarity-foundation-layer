/**
 * NIGHTLY SCHEDULER ENTRY POINT.
 *
 * Called by the database scheduler (pg_cron) over HTTP. The caller must prove
 * it is the scheduler with the private shared token; the route is otherwise
 * completely inert.
 *
 * The endpoint does a BOUNDED slice of work and returns. The schedule ticks
 * every few minutes, so a large portfolio finishes across several ticks
 * instead of one long request.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/wh-nightly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        const token =
          request.headers.get("x-cron-token") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!token) return json({ error: "Missing scheduler token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;

        const { data: ok } = await admin.rpc("verify_cron_token", {
          _name: "wh_nightly",
          _token: token,
        });
        if (ok !== true) return json({ error: "Invalid scheduler token" }, 401);

        let maxCommunities = 2;
        try {
          const body = (await request.json()) as { maxCommunities?: number } | null;
          if (body?.maxCommunities) maxCommunities = Math.max(1, Math.min(Number(body.maxCommunities), 5));
        } catch {
          /* empty body is the normal case */
        }

        const { ensureNightlyRun, tickNightlyRun } = await import("@/lib/wh/nightly.server");

        // Active WelcomeHome connections, one nightly run per organization.
        const { data: connections } = await admin
          .from("data_source_connections")
          .select("id, organization_id, source_type")
          .eq("source_type", "welcomehome");

        const results: unknown[] = [];
        for (const conn of (connections ?? []) as { id: string; organization_id: string }[]) {
          try {
            const ensured = await ensureNightlyRun(admin, {
              organizationId: conn.organization_id,
              connectionId: conn.id,
              triggeredBy: "schedule",
            });
            if (!ensured.runId) {
              results.push({ organizationId: conn.organization_id, skipped: ensured.reason });
              continue;
            }
            const tick = await tickNightlyRun(admin, ensured.runId, { maxCommunities });
            results.push({ organizationId: conn.organization_id, ...tick });
          } catch (err) {
            results.push({
              organizationId: conn.organization_id,
              error: err instanceof Error ? err.message : "nightly tick failed",
            });
          }
        }

        return json({ ok: true, ranAt: new Date().toISOString(), results });
      },
    },
  },
});
