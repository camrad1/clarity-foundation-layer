/**
 * GOOGLE OAUTH CALLBACK.
 *
 * Google redirects the admin's browser here after authorization. The route is
 * public only because Google cannot present a session; it is safe because the
 * one-time `state` row is the sole authority for which organization/service the
 * authorization belongs to, and it is consumed immediately.
 *
 * The authorization code is exchanged server-side; no token ever reaches the
 * browser.
 */

import { createFileRoute } from "@tanstack/react-router";

function done(path: string, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: `${path}?${qs}` } });
}

export const Route = createFileRoute("/api/public/google/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");

        if (!state) return new Response("Missing state", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;

        const { data: stateRow } = await admin
          .from("google_oauth_states")
          .select("*")
          .eq("state", state)
          .maybeSingle();

        if (!stateRow || stateRow.consumed_at || Date.parse(stateRow.expires_at) < Date.now()) {
          return new Response("This Google sign-in request is no longer valid.", { status: 400 });
        }
        await admin
          .from("google_oauth_states")
          .update({ consumed_at: new Date().toISOString() })
          .eq("state", state);

        const fallback =
          stateRow.service === "ga4" ? "/admin/ga4-connection" : "/admin/search-console-connection";
        const returnPath: string =
          typeof stateRow.return_path === "string" && stateRow.return_path.startsWith("/")
            ? stateRow.return_path
            : fallback;

        if (errorParam || !code) {
          return done(returnPath, { google: "error", reason: errorParam ?? "no_code" });
        }

        const { exchangeCode, emailFromIdToken, storeTokens } = await import(
          "@/lib/google/oauth.server"
        );

        try {
          const tokens = await exchangeCode(code, stateRow.redirect_uri);

          const { data: connection } = await admin
            .from("google_connections")
            .select("id")
            .eq("organization_id", stateRow.organization_id)
            .eq("service", stateRow.service)
            .maybeSingle();

          let connectionId: string | undefined = connection?.id;
          if (!connectionId) {
            const { data: created } = await admin
              .from("google_connections")
              .insert({
                organization_id: stateRow.organization_id,
                service: stateRow.service,
                status: "authorized",
              })
              .select("id")
              .single();
            connectionId = created?.id;
          }
          if (!connectionId) throw new Error("Could not create the Google connection record.");

          await storeTokens(admin, connectionId, tokens);
          await admin
            .from("google_connections")
            .update({
              status: "authorized",
              google_account_email: emailFromIdToken(tokens.id_token),
              granted_scopes: tokens.scope ? tokens.scope.split(" ") : null,
              connected_by: stateRow.requested_by,
              last_error: null,
            })
            .eq("id", connectionId);

          return done(returnPath, { google: "connected" });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Google authorization failed";
          return done(returnPath, { google: "error", reason: message.slice(0, 200) });
        }
      },
    },
  },
});
