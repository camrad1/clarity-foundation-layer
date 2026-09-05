/**
 * GOOGLE SEARCH CONSOLE BACKFILL ENTRY POINT.
 *
 * Called with the private `google_backfill` scheduler token. Performs a bounded
 * slice of the historical Search Console pull and returns; call again to
 * continue. Read-only against Google, additive-only in the database.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/google-backfill")({
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
          _name: "google_backfill",
          _token: token,
        });
        if (ok !== true) return json({ error: "Invalid scheduler token" }, 401);

        let mode: "plan" | "run" = "run";
        try {
          const body = (await request.json()) as { mode?: string } | null;
          if (body?.mode === "plan") mode = "plan";
        } catch {
          /* empty body means: run a slice */
        }

        const { data: connections } = await admin
          .from("google_connections")
          .select("id, organization_id, selected_property_id")
          .eq("service", "search_console")
          .eq("status", "connected");

        const { getAccessToken } = await import("@/lib/google/oauth.server");
        const backfill = await import("@/lib/google/backfill.server");

        const results: unknown[] = [];
        for (const conn of (connections ?? []) as any[]) {
          if (!conn.selected_property_id) {
            results.push({ organizationId: conn.organization_id, skipped: "no_property" });
            continue;
          }
          try {
            const accessToken = await getAccessToken(admin, conn.id);
            if (mode === "plan") {
              results.push({
                organizationId: conn.organization_id,
                plan: await backfill.planSearchConsoleBackfill(admin, {
                  organizationId: conn.organization_id,
                  connectionId: conn.id,
                  propertyId: conn.selected_property_id,
                  accessToken,
                }),
              });
            } else {
              results.push({
                organizationId: conn.organization_id,
                slice: await backfill.runSearchConsoleBackfillSlice(admin, {
                  organizationId: conn.organization_id,
                  propertyId: conn.selected_property_id,
                  accessToken,
                  budgetMs: 40_000,
                }),
              });
            }
          } catch (e) {
            results.push({
              organizationId: conn.organization_id,
              error: e instanceof Error ? e.message.slice(0, 400) : String(e),
            });
          }
        }

        return json({ ok: true, mode, ranAt: new Date().toISOString(), results });
      },
    },
  },
});
