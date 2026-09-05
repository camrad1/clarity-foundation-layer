/**
 * Google connection server functions (Search Console + GA4).
 *
 * SECURITY MODEL
 * --------------
 * 1. Every function requires an authenticated session.
 * 2. The caller must pass can_manage_imports() for the organization, checked
 *    through the CALLER's RLS-scoped client.
 * 3. Only then does the service-role client touch tokens.
 * 4. The OAuth client secret and all tokens stay server-side; they are never
 *    returned to the browser and never logged.
 * 5. Every Google call is READ-ONLY.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GOOGLE_SCOPES, isAllowedOrigin, type GoogleService } from "./config";

const serviceSchema = z.enum(["search_console", "ga4"]);

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function guard(supabase: any, organizationId: string): Promise<string> {
  const { data: allowed, error } = await supabase.rpc("can_manage_imports", {
    _org_id: organizationId,
  });
  if (error || allowed !== true) throw new Error("Not permitted to manage this connection");
  return organizationId;
}

async function ensureConnection(
  admin: any,
  organizationId: string,
  service: GoogleService,
): Promise<any> {
  const { data: existing } = await admin
    .from("google_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service", service)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("google_connections")
    .insert({ organization_id: organizationId, service, status: "disconnected" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Setup info for the Admin pages: the exact redirect URI to register in Google Cloud. */
export const googleSetupInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { googleOauthConfigured } = await import("./oauth.server");
    const { GOOGLE_OAUTH_CALLBACK_PATH } = await import("./config");
    const override = process.env["GOOGLE_OAUTH_REDIRECT_URI"] ?? null;
    return {
      configured: googleOauthConfigured(),
      callbackPath: GOOGLE_OAUTH_CALLBACK_PATH,
      redirectUriOverride: override,
    };
  });

/** Creates a one-time state row and returns the Google authorization URL. */
export const googleStartConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        service: serviceSchema,
        origin: z.string().url(),
        returnPath: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    if (!isAllowedOrigin(data.origin)) throw new Error("Unrecognized application origin.");

    const { buildAuthUrl, resolveRedirectUri } = await import("./oauth.server");
    const redirectUri = resolveRedirectUri(data.origin);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId, data.service);

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await admin.from("google_oauth_states").insert({
      state,
      organization_id: data.organizationId,
      service: data.service,
      redirect_uri: redirectUri,
      return_path: data.returnPath ?? null,
      requested_by: (context as any).userId ?? null,
    });
    if (error) throw new Error(error.message);

    return {
      authUrl: buildAuthUrl({
        service: data.service,
        state,
        redirectUri,
        loginHint: connection.google_account_email ?? null,
      }),
      redirectUri,
    };
  });

/** Lists the properties the authorized Google account can read (read-only). */
export const googleListProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ organizationId: z.string().uuid(), service: serviceSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId, data.service);
    const { getAccessToken } = await import("./oauth.server");
    const token = await getAccessToken(admin, connection.id);
    const { listGa4Properties, listSearchConsoleProperties } = await import("./api.server");

    try {
      if (data.service === "search_console") {
        const properties = await listSearchConsoleProperties(token);
        await admin
          .from("google_connections")
          .update({ last_error: null })
          .eq("id", connection.id);
        return { service: data.service, properties, ga4Properties: [] as never[] };
      }
      const ga4Properties = await listGa4Properties(token);
      await admin.from("google_connections").update({ last_error: null }).eq("id", connection.id);
      return { service: data.service, properties: [] as never[], ga4Properties };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("google_connections")
        .update({ last_error: message.slice(0, 1000) })
        .eq("id", connection.id);
      throw new Error(message);
    }
  });

/** Saves the canonical property choice for this organization. */
export const googleSelectProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        service: serviceSchema,
        propertyId: z.string().min(1).max(400),
        propertyName: z.string().max(400).optional(),
        propertyType: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId, data.service);
    const { error } = await admin
      .from("google_connections")
      .update({
        selected_property_id: data.propertyId,
        selected_property_name: data.propertyName ?? data.propertyId,
        selected_property_type: data.propertyType ?? null,
        status: "connected",
      })
      .eq("id", connection.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Revokes Google access and clears the stored tokens. Imported data is kept. */
export const googleDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ organizationId: z.string().uuid(), service: serviceSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId, data.service);
    const { revokeTokens } = await import("./oauth.server");
    await revokeTokens(admin, connection.id);
    await admin
      .from("google_connections")
      .update({
        status: "disconnected",
        google_account_email: null,
        granted_scopes: null,
        last_error: null,
      })
      .eq("id", connection.id);
    return { ok: true };
  });

export const GOOGLE_REQUIRED_SCOPES = GOOGLE_SCOPES;
