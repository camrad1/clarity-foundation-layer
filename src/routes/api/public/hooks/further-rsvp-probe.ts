/**
 * TEMPORARY diagnostic route — Further event/RSVP probe.
 * Read-only: no database writes. Delete after the diagnostic is complete.
 */

import { createFileRoute } from "@tanstack/react-router";

const PROBE_HEADER = "x-probe-token";
const PROBE_TOKEN = "further-rsvp-probe-2026-09-10";

export const Route = createFileRoute("/api/public/hooks/further-rsvp-probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get(PROBE_HEADER) !== PROBE_TOKEN) {
          return new Response("Forbidden", { status: 403 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          search?: string;
          leadId?: string;
        };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const { data: conn } = await admin
          .from("data_source_connections")
          .select("id")
          .eq("source_type", "further")
          .limit(1)
          .maybeSingle();
        const { data: cred } = await admin
          .from("data_source_credentials")
          .select("secret_value")
          .eq("connection_id", conn?.id)
          .maybeSingle();
        const key = cred?.secret_value as string | undefined;
        if (!key) return new Response(JSON.stringify({ error: "no key" }), { status: 500 });

        const { furtherGet, safeError } = await import("@/lib/further/api.server");
        const out: Record<string, unknown> = {};
        try {
          if (body.search) {
            out["leadsSearch"] = await furtherGet(
              { key },
              "/api/v1/leads/",
              { search: body.search },
            );
          }
          if (body.leadId) {
            out["conversation"] = await furtherGet(
              { key },
              `/api/v1/conversations/leads/${encodeURIComponent(body.leadId)}`,
            );
          }
        } catch (err) {
          out["error"] = safeError(err);
        }
        return new Response(JSON.stringify(out), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
