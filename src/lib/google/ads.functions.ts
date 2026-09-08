/**
 * Google Ads connection server functions.
 *
 * SECURITY MODEL — identical to the Search Console / GA4 connection:
 * 1. Authenticated session required.
 * 2. Caller must pass can_manage_imports() for the organization, checked with
 *    the CALLER's RLS-scoped client.
 * 3. Only then does the service-role client touch tokens.
 * 4. Developer token, client secret and refresh token stay server-side.
 * 5. Every Google Ads call is READ-ONLY. No mutate endpoint is reachable.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// Type-only: erased at build, so no server module reaches the client bundle.
import type { AdsAccount, AdsGrain } from "./ads.server";

const SERVICE = "google_ads" as const;

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function guard(supabase: any, organizationId: string) {
  const { data: allowed, error } = await supabase.rpc("can_manage_imports", {
    _org_id: organizationId,
  });
  if (error || allowed !== true) throw new Error("Not permitted to manage this connection");
}

async function ensureConnection(admin: any, organizationId: string): Promise<any> {
  const { data: existing } = await admin
    .from("google_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service", SERVICE)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("google_connections")
    .insert({ organization_id: organizationId, service: SERVICE, status: "disconnected" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function tokenFor(admin: any, connectionId: string): Promise<string> {
  const { getAccessToken } = await import("./oauth.server");
  return getAccessToken(admin, connectionId);
}

const orgInput = (d: unknown) => z.object({ organizationId: z.string().uuid() }).parse(d);

/** Setup readiness: OAuth client + developer token, without revealing values. */
export const adsSetupInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { googleOauthConfigured } = await import("./oauth.server");
    const { adsDeveloperTokenConfigured, maskedTokenHint, adsApiVersion } = await import(
      "./ads.server"
    );
    const { GOOGLE_OAUTH_CALLBACK_PATH } = await import("./config");
    return {
      oauthConfigured: googleOauthConfigured(),
      developerTokenConfigured: adsDeveloperTokenConfigured(),
      developerTokenHint: maskedTokenHint(),
      callbackPath: GOOGLE_OAUTH_CALLBACK_PATH,
      redirectUriOverride: process.env["GOOGLE_OAUTH_REDIRECT_URI"] ?? null,
      apiVersion: adsApiVersion(),
    };
  });

/** Read-only account discovery across everything the Google user can reach. */
export const adsDiscoverAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orgInput)
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId);
    const token = await tokenFor(admin, connection.id);
    const ads = await import("./ads.server");

    try {
      const roots = await ads.listAccessibleCustomers(token);
      const seen = new Map<string, AdsAccount>();
      const errors: string[] = [];
      const skipped: Array<{ customerId: string; reason: string; detail: string }> = [];
      for (const root of roots) {
        try {
          for (const acct of await ads.listCustomerClients(token, root)) {
            if (acct.customerId && !seen.has(acct.customerId)) seen.set(acct.customerId, acct);
          }
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          // One unusable customer must never abort discovery of the others.
          const reason = /CUSTOMER_NOT_ENABLED/i.test(detail)
            ? "Not enabled for API reporting (cancelled, suspended or never activated)"
            : /USER_PERMISSION_DENIED|NOT_ADS_USER/i.test(detail)
              ? "The authorized Google user cannot access this account"
              : "Could not be listed";
          skipped.push({ customerId: root, reason, detail: detail.slice(0, 400) });
          errors.push(`${root}: ${reason}`);
        }
      }
      const accounts = [...seen.values()].sort((a, b) =>
        (a.descriptiveName ?? a.customerId).localeCompare(b.descriptiveName ?? b.customerId),
      );
      await admin.from("google_connections").update({ last_error: null }).eq("id", connection.id);
      return { accessibleCustomerIds: roots, accounts, errors, skipped };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("google_connections")
        .update({ last_error: message.slice(0, 1000) })
        .eq("id", connection.id);
      throw new Error(message);
    }
  });

/** Saves the explicitly chosen ONELIFE client account. No name-based guessing. */
export const adsSelectAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        customerId: z.string().min(5).max(20),
        managerCustomerId: z.string().max(20).nullable().optional(),
        accountName: z.string().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId);
    const token = await tokenFor(admin, connection.id);
    const ads = await import("./ads.server");

    const customerId = ads.digitsOnly(data.customerId);
    const loginCustomerId = data.managerCustomerId ? ads.digitsOnly(data.managerCustomerId) : null;
    const customer = await ads.fetchCustomer({ accessToken: token, customerId, loginCustomerId });

    const { error } = await admin
      .from("google_connections")
      .update({
        status: "connected",
        ads_customer_id: customerId,
        ads_manager_customer_id: loginCustomerId,
        ads_customer_name: customer.descriptiveName ?? data.accountName ?? customerId,
        ads_currency_code: customer.currencyCode,
        ads_time_zone: customer.timeZone,
        selected_property_id: customerId,
        selected_property_name: customer.descriptiveName ?? customerId,
        selected_property_type: loginCustomerId ? `Manager ${loginCustomerId}` : "Direct access",
        ads_test_ok_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", connection.id);
    if (error) throw new Error(error.message);
    return { ok: true, customer };
  });

/** Lightweight read-only connection test. */
export const adsTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orgInput)
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId);
    if (!connection.ads_customer_id) throw new Error("Select a Google Ads account first.");
    const token = await tokenFor(admin, connection.id);
    const ads = await import("./ads.server");
    try {
      const customer = await ads.fetchCustomer({
        accessToken: token,
        customerId: connection.ads_customer_id,
        loginCustomerId: connection.ads_manager_customer_id,
      });
      await admin
        .from("google_connections")
        .update({
          ads_test_ok_at: new Date().toISOString(),
          ads_currency_code: customer.currencyCode,
          ads_time_zone: customer.timeZone,
          last_error: null,
        })
        .eq("id", connection.id);
      return { ok: true, customer, apiVersion: ads.adsApiVersion() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("google_connections")
        .update({ last_error: message.slice(0, 1000) })
        .eq("id", connection.id);
      throw new Error(message);
    }
  });

/**
 * BOUNDED VALIDATION PULL. Latest complete days only (never the partial current
 * day), written to google_ads_api_facts alone. Nothing else in the app reads
 * this table, so no dashboard, KPI or canonical layer is affected.
 */
export const adsValidationPull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        days: z.number().int().min(1).max(14).default(7),
        includeBreakdowns: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId);
    if (!connection.ads_customer_id) throw new Error("Select a Google Ads account first.");
    const token = await tokenFor(admin, connection.id);
    const ads = await import("./ads.server");

    const customerId = ads.digitsOnly(connection.ads_customer_id);
    const loginCustomerId = connection.ads_manager_customer_id ?? null;
    const customer = await ads.fetchCustomer({ accessToken: token, customerId, loginCustomerId });
    const window = ads.completeWindow(customer.timeZone, data.days);

    const { data: run } = await admin
      .from("google_sync_runs")
      .insert({
        organization_id: data.organizationId,
        connection_id: connection.id,
        service: SERVICE,
        run_type: "validation",
        status: "running",
        property_id: customerId,
        range_start: window.start,
        range_end: window.end,
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
      const grains: AdsGrain[] = data.includeBreakdowns
        ? ["account_day", "campaign_day", "conversion_action_day", "device_day", "ad_group_day"]
        : ["account_day", "campaign_day", "conversion_action_day"];

      const perGrain: Record<string, { rows: number; error?: string }> = {};
      let written = 0;
      const fetchedAt = new Date().toISOString();

      for (const grain of grains) {
        try {
          const rows = await ads.gaql({
            accessToken: token,
            customerId,
            loginCustomerId,
            query: ads.ADS_QUERIES[grain](window.start, window.end),
          });
          const payload = rows.map((r) => ({
            organization_id: data.organizationId,
            connection_id: connection.id,
            sync_run_id: run?.id ?? null,
            source_system: "google_ads_api",
            customer_id: customerId,
            login_customer_id: loginCustomerId,
            currency_code: customer.currencyCode,
            time_zone: customer.timeZone,
            fetched_at: fetchedAt,
            ...ads.toAdsFact(grain, r),
          }));
          for (let i = 0; i < payload.length; i += 500) {
            const { error } = await admin
              .from("google_ads_api_facts")
              .upsert(payload.slice(i, i + 500), {
                onConflict: "organization_id,customer_id,grain,date,dim_key",
              });
            if (error) throw new Error(error.message);
          }
          perGrain[grain] = { rows: payload.length };
          written += payload.length;
        } catch (e) {
          perGrain[grain] = { rows: 0, error: e instanceof Error ? e.message : String(e) };
        }
      }

      // Conversion action configuration (what the account counts as a conversion).
      let conversionActions: any[] = [];
      try {
        conversionActions = await ads.fetchConversionActions({
          accessToken: token,
          customerId,
          loginCustomerId,
        });
      } catch {
        conversionActions = [];
      }

      const details = { window, perGrain, conversionActions: conversionActions.length };
      await finish({
        status: Object.values(perGrain).some((g) => g.error) ? "partial" : "success",
        rows_written: written,
        details,
      });
      await admin
        .from("google_connections")
        .update({
          last_attempted_sync_at: new Date().toISOString(),
          last_successful_sync_at: written > 0 ? new Date().toISOString() : connection.last_successful_sync_at,
          latest_data_date: window.end,
          rows_synced: (connection.rows_synced ?? 0) + written,
          ads_currency_code: customer.currencyCode,
          ads_time_zone: customer.timeZone,
          last_error: null,
        })
        .eq("id", connection.id);

      return {
        ok: true,
        customerId,
        accountName: customer.descriptiveName,
        currencyCode: customer.currencyCode,
        timeZone: customer.timeZone,
        window,
        rowsByGrain: perGrain,
        conversionActions,
        note: "Validation only. Google Ads data is not canonical and is not used by any dashboard.",
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
 * Reconciliation summary read back from the stored facts: account totals,
 * campaign totals and conversion-action mix for the validated window.
 */
export const adsValidationSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orgInput)
  .handler(async ({ data, context }) => {
    await guard(context.supabase as any, data.organizationId);
    const admin = await adminClient();
    const connection = await ensureConnection(admin, data.organizationId);
    if (!connection.ads_customer_id) return null;

    const { data: rows } = await admin
      .from("google_ads_api_facts")
      .select("*")
      .eq("organization_id", data.organizationId)
      .eq("customer_id", connection.ads_customer_id)
      .order("date", { ascending: true })
      .limit(20000);

    const all = (rows ?? []) as any[];
    if (all.length === 0) return null;

    const dates = all.map((r) => r.date as string).sort();
    const sum = (list: any[], key: string) =>
      list.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

    const account = all.filter((r) => r.grain === "account_day");
    const campaigns = all.filter((r) => r.grain === "campaign_day");
    const conversions = all.filter((r) => r.grain === "conversion_action_day");

    const totals = (list: any[]) => {
      const impressions = sum(list, "impressions");
      const clicks = sum(list, "clicks");
      const costMicros = sum(list, "cost_micros");
      return {
        impressions,
        clicks,
        costMicros,
        cost: costMicros / 1_000_000,
        ctr: impressions > 0 ? clicks / impressions : null,
        averageCpc: clicks > 0 ? costMicros / 1_000_000 / clicks : null,
        conversions: sum(list, "conversions"),
        conversionsValue: sum(list, "conversions_value"),
      };
    };

    const byCampaign = new Map<string, any>();
    for (const r of campaigns) {
      const key = String(r.campaign_id ?? r.campaign_name ?? "-");
      const cur = byCampaign.get(key) ?? {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        status: r.campaign_status,
        channel: r.advertising_channel_type,
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: 0,
        conversionsValue: 0,
      };
      cur.impressions += Number(r.impressions ?? 0);
      cur.clicks += Number(r.clicks ?? 0);
      cur.costMicros += Number(r.cost_micros ?? 0);
      cur.conversions += Number(r.conversions ?? 0);
      cur.conversionsValue += Number(r.conversions_value ?? 0);
      byCampaign.set(key, cur);
    }

    const byAction = new Map<string, any>();
    for (const r of conversions) {
      const key = String(r.conversion_action_name ?? r.conversion_action_id ?? "-");
      const cur = byAction.get(key) ?? {
        name: r.conversion_action_name,
        actionId: r.conversion_action_id,
        category: r.conversion_action_category,
        conversions: 0,
        conversionsValue: 0,
      };
      cur.conversions += Number(r.conversions ?? 0);
      cur.conversionsValue += Number(r.conversions_value ?? 0);
      byAction.set(key, cur);
    }

    const grainCounts: Record<string, number> = {};
    for (const r of all) grainCounts[r.grain] = (grainCounts[r.grain] ?? 0) + 1;

    return {
      customerId: connection.ads_customer_id,
      accountName: connection.ads_customer_name,
      currencyCode: connection.ads_currency_code,
      timeZone: connection.ads_time_zone,
      range: { start: dates[0], end: dates[dates.length - 1] },
      rowsByGrain: grainCounts,
      accountTotals: totals(account),
      campaignTotals: totals(campaigns),
      topCampaigns: [...byCampaign.values()]
        .map((c) => ({ ...c, cost: c.costMicros / 1_000_000 }))
        .sort((a, b) => b.costMicros - a.costMicros)
        .slice(0, 15),
      conversionActionMix: [...byAction.values()].sort((a, b) => b.conversions - a.conversions),
    };
  });
