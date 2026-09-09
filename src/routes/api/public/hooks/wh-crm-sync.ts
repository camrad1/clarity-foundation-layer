/**
 * SCHEDULED CRM REFRESH ENTRY POINT.
 *
 * Called by the database scheduler over HTTP with the same private token the
 * nightly worker uses. Does a BOUNDED slice of work (a couple of dataset x
 * community units) and returns; the schedule ticks again for the rest.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/wh-crm-sync")({
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

        let maxUnits = 2;
        try {
          const body = (await request.json()) as { maxUnits?: number } | null;
          if (body?.maxUnits) maxUnits = Math.max(1, Math.min(Number(body.maxUnits), 4));
        } catch {
          /* empty body is the normal case */
        }

        const { tickCrmRefresh } = await import("@/lib/wh/crm-refresh.server");

        const { data: connections } = await admin
          .from("data_source_connections")
          .select("id, organization_id")
          .eq("source_type", "welcomehome");

        const results: unknown[] = [];
        for (const conn of (connections ?? []) as { id: string; organization_id: string }[]) {
          try {
            results.push(
              await tickCrmRefresh(admin, {
                organizationId: conn.organization_id,
                connectionId: conn.id,
                maxUnits,
              }),
            );
          } catch (err) {
            results.push({
              organizationId: conn.organization_id,
              error: err instanceof Error ? err.message : "crm refresh tick failed",
            });
          }
        }

        return json({ ok: true, ranAt: new Date().toISOString(), results });
      },
    },
  },
});
