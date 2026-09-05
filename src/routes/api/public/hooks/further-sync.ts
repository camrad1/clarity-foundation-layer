/**
 * FURTHER SCHEDULER ENTRY POINT.
 *
 * Called by the database scheduler (pg_cron) over HTTP with the private
 * `further_sync` token; the route is otherwise completely inert. No browser tab
 * is ever involved in Further synchronization.
 *
 * scope=hourly   → leads, changed lead details, timelines for new/changed leads
 * scope=nightly  → visitors, community reconciliation, wider lead reconciliation
 *
 * Each call performs a BOUNDED slice inside a time budget and returns; the
 * schedule ticks again to continue.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/further-sync")({
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
          _name: "further_sync",
          _token: token,
        });
        if (ok !== true) return json({ error: "Invalid scheduler token" }, 401);

        let scope: "hourly" | "nightly" = "hourly";
        try {
          const body = (await request.json()) as { scope?: string } | null;
          if (body?.scope === "nightly") scope = "nightly";
        } catch {
          /* empty body is the normal case */
        }

        const { FURTHER_HOURLY_DATASETS, FURTHER_NIGHTLY_DATASETS } = await import(
          "@/lib/further/tables"
        );
        const { runFurtherSlice } = await import("@/lib/further/sync.server");

        const { data: connections } = await admin
          .from("data_source_connections")
          .select("id, organization_id")
          .eq("source_type", "further");

        const results: unknown[] = [];
        for (const conn of (connections ?? []) as { id: string; organization_id: string }[]) {
          try {
            const { data: cred } = await admin
              .from("data_source_credentials")
              .select("secret_value")
              .eq("connection_id", conn.id)
              .maybeSingle();
            const key = cred?.secret_value as string | undefined;
            if (!key) {
              results.push({ organizationId: conn.organization_id, skipped: "no_api_key" });
              continue;
            }
            const slice = await runFurtherSlice(
              admin,
              { key },
              {
                organizationId: conn.organization_id,
                connectionId: conn.id,
                datasets: scope === "nightly" ? FURTHER_NIGHTLY_DATASETS : FURTHER_HOURLY_DATASETS,
                mode: "incremental",
                trigger: "schedule",
                budgetMs: 40_000,
              },
            );
            results.push({
              organizationId: conn.organization_id,
              status: slice.status,
              remaining: slice.remaining,
              units: slice.units.map((u) => ({
                dataset: u.dataset,
                status: u.status,
                received: u.rowsReceived,
              })),
            });
          } catch (err) {
            // Never leak key-shaped values into scheduler output.
            const { safeError } = await import("@/lib/further/api.server");
            results.push({ organizationId: conn.organization_id, error: safeError(err) });
          }
        }

        return json({ ok: true, scope, ranAt: new Date().toISOString(), results });
      },
    },
  },
});
