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

/**
 * Bounded VALIDATION sync. Pulls only a few recent days and stores the results
 * in the separate google_api fact tables. It never touches manual imports,
 * WelcomeHome, Further, occupancy data, or any dashboard metric, and it never
 * makes API data canonical.
 */
export const googleValidationSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        service: serviceSchema,
        days: z.number().int().min(1).max(14).default(5),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId, data.service);
    if (!connection.selected_property_id) {
      throw new Error("Select a property before running a validation sync.");
    }
    const { getAccessToken } = await import("./oauth.server");
    const token = await getAccessToken(admin, connection.id);
    const sync = await import("./sync.server");

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const shift = (n: number) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - n);
      return d;
    };

    const { data: run } = await admin
      .from("google_sync_runs")
      .insert({
        organization_id: data.organizationId,
        connection_id: connection.id,
        service: data.service,
        run_type: "validation",
        status: "running",
        property_id: connection.selected_property_id,
      })
      .select("*")
      .single();

    const finish = async (patch: Record<string, unknown>) => {
      if (run?.id) {
        await admin
          .from("google_sync_runs")
          .update({ ...patch, finished_at: new Date().toISOString() })
          .eq("id", run.id);
      }
    };

    try {
      if (data.service === "search_console") {
        // Probe a wider window to find the latest date Google actually has.
        const probe = await sync.fetchSearchAnalytics({
          accessToken: token,
          property: connection.selected_property_id,
          startDate: iso(shift(12)),
          endDate: iso(today),
          grain: "date",
        });
        const availableDates = probe.rows
          .map((r) => r.keys[0])
          .filter(Boolean)
          .sort();
        if (availableDates.length === 0) {
          await finish({ status: "failed", error_summary: "Google returned no finalized rows." });
          return { ok: false, message: "Google returned no finalized data for the probe window." };
        }
        const latest = availableDates[availableDates.length - 1]!;
        const window = availableDates.slice(-data.days);
        const startDate = window[0]!;
        const endDate = latest;

        const grains: sync.ScGrain[] = [
          "date",
          "query",
          "page",
          "query_page",
          "device",
          "country",
          "search_appearance",
        ];
        const perGrain: Record<string, { rows: number; pages: number; truncated: boolean; error?: string }> = {};
        let written = 0;

        for (const grain of grains) {
          try {
            const res =
              grain === "date"
                ? { rows: probe.rows.filter((r) => (r.keys[0] ?? "") >= startDate), pages: probe.pages, truncated: false }
                : await sync.fetchSearchAnalytics({
                    accessToken: token,
                    property: connection.selected_property_id,
                    startDate,
                    endDate,
                    grain,
                  });
            const payload = res.rows.map((r) => ({
              organization_id: data.organizationId,
              connection_id: connection.id,
              source_system: "google_api",
              property_id: connection.selected_property_id,
              ...sync.toScFact(grain, r.keys),
              clicks: Math.round(r.clicks ?? 0),
              impressions: Math.round(r.impressions ?? 0),
              ctr: r.ctr ?? null,
              position: r.position ?? null,
              sync_run_id: run?.id ?? null,
              fetched_at: new Date().toISOString(),
            }));
            for (let i = 0; i < payload.length; i += 500) {
              const chunk = payload.slice(i, i + 500);
              const { error } = await admin
                .from("gsc_api_facts")
                .upsert(chunk, {
                  onConflict: "organization_id,property_id,grain,date,dim_key",
                });
              if (error) throw new Error(error.message);
            }
            written += payload.length;
            perGrain[grain] = { rows: payload.length, pages: res.pages, truncated: res.truncated };
          } catch (e) {
            perGrain[grain] = {
              rows: 0,
              pages: 0,
              truncated: false,
              error: e instanceof Error ? e.message.slice(0, 300) : String(e),
            };
          }
        }

        await finish({
          status: "complete",
          range_start: startDate,
          range_end: endDate,
          rows_written: written,
          details: { grains: perGrain, latest_available_date: latest },
        });
        await admin
          .from("google_connections")
          .update({
            last_attempted_sync_at: new Date().toISOString(),
            last_successful_sync_at: new Date().toISOString(),
            latest_data_date: latest,
            rows_synced: (connection.rows_synced ?? 0) + written,
            last_error: null,
          })
          .eq("id", connection.id);

        return {
          ok: true,
          service: data.service,
          startDate,
          endDate,
          latestAvailableDate: latest,
          rowsWritten: written,
          grains: perGrain,
        };
      }

      // ---- GA4 ----
      const startDate = iso(shift(data.days));
      const endDate = iso(shift(1));
      const reports: sync.Ga4Report[] = ["daily_totals", "source_medium", "landing_page"];
      const perReport: Record<string, { rows: number; totalRows: number; error?: string }> = {};
      let written = 0;
      let latest: string | null = null;

      for (const report of reports) {
        try {
          const res = await sync.fetchGa4Report({
            accessToken: token,
            propertyId: connection.selected_property_id,
            startDate,
            endDate,
            report,
            limit: report === "daily_totals" ? 100 : 200,
          });
          const payload = res.rows.map((row) => {
            const fact = sync.toGa4Fact(report, row);
            if (!latest || fact.date > latest) latest = fact.date;
            return {
              organization_id: data.organizationId,
              connection_id: connection.id,
              source_system: "google_api",
              property_id: connection.selected_property_id,
              ...fact,
              sync_run_id: run?.id ?? null,
              fetched_at: new Date().toISOString(),
            };
          });
          for (let i = 0; i < payload.length; i += 500) {
            const { error } = await admin
              .from("ga4_api_facts")
              .upsert(payload.slice(i, i + 500), {
                onConflict: "organization_id,property_id,report,date,dim_key",
              });
            if (error) throw new Error(error.message);
          }
          written += payload.length;
          perReport[report] = { rows: payload.length, totalRows: res.rowCount };
        } catch (e) {
          perReport[report] = {
            rows: 0,
            totalRows: 0,
            error: e instanceof Error ? e.message.slice(0, 300) : String(e),
          };
        }
      }

      await finish({
        status: "complete",
        range_start: startDate,
        range_end: endDate,
        rows_written: written,
        details: { reports: perReport, latest_available_date: latest },
      });
      await admin
        .from("google_connections")
        .update({
          last_attempted_sync_at: new Date().toISOString(),
          last_successful_sync_at: new Date().toISOString(),
          latest_data_date: latest,
          rows_synced: (connection.rows_synced ?? 0) + written,
          last_error: null,
        })
        .eq("id", connection.id);

      return {
        ok: true,
        service: data.service,
        startDate,
        endDate,
        latestAvailableDate: latest,
        rowsWritten: written,
        reports: perReport,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await finish({ status: "failed", error_summary: message.slice(0, 1000) });
      await admin
        .from("google_connections")
        .update({
          last_attempted_sync_at: new Date().toISOString(),
          last_error: message.slice(0, 1000),
        })
        .eq("id", connection.id);
      throw new Error(message);
    }
  });

/**
 * Read-only comparison of API daily totals against the active manual import
 * daily facts for the same dates. Reports differences only: nothing is
 * reconciled, overwritten, or deleted.
 */
export const googleCompareSearchConsole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ organizationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();

    const { data: apiRows } = await admin
      .from("gsc_api_facts")
      .select("date, clicks, impressions, position")
      .eq("organization_id", data.organizationId)
      .eq("grain", "date")
      .order("date");

    const dates = (apiRows ?? []).map((r: any) => r.date as string);
    if (dates.length === 0) return { overlap: [], apiOnly: [], note: "No API rows yet." };

    const { data: manualRows } = await admin
      .from("gsc_daily_facts")
      .select("date, clicks, impressions, position, import_id")
      .eq("organization_id", data.organizationId)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]);

    const manualByDate = new Map<string, { clicks: number; impressions: number }>();
    for (const r of (manualRows ?? []) as any[]) {
      const prev = manualByDate.get(r.date);
      // Manual daily facts can exist in more than one import; keep the max
      // (most complete) rather than summing duplicates.
      manualByDate.set(r.date, {
        clicks: Math.max(prev?.clicks ?? 0, r.clicks ?? 0),
        impressions: Math.max(prev?.impressions ?? 0, r.impressions ?? 0),
      });
    }

    const overlap: any[] = [];
    const apiOnly: any[] = [];
    for (const r of (apiRows ?? []) as any[]) {
      const m = manualByDate.get(r.date);
      if (!m) {
        apiOnly.push({ date: r.date, apiClicks: r.clicks, apiImpressions: r.impressions });
        continue;
      }
      overlap.push({
        date: r.date,
        apiClicks: r.clicks,
        manualClicks: m.clicks,
        clickDelta: r.clicks - m.clicks,
        apiImpressions: r.impressions,
        manualImpressions: m.impressions,
        impressionDelta: r.impressions - m.impressions,
      });
    }
    return { overlap, apiOnly, note: "Comparison only — no data was changed." };
  });
