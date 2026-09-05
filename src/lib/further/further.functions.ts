/**
 * Further server functions.
 *
 * SECURITY MODEL (identical to the WelcomeHome integration)
 * --------------------------------------------------------
 * 1. Every function requires an authenticated session.
 * 2. The connection id is resolved through the CALLER's RLS-scoped client, so
 *    no caller can reach another organization's connection.
 * 3. The caller must also pass can_manage_imports() for that organization.
 * 4. Only then does the service-role client load the API key and read Further.
 * 5. The Organization API Key is write-only: never returned, never logged.
 * 6. Further access is READ-ONLY — no write endpoint is ever called.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FURTHER_DATASETS,
  FURTHER_HOURLY_DATASETS,
  FURTHER_NIGHTLY_DATASETS,
  type FurtherDataset,
} from "./tables";

const connectionInput = z.object({ connectionId: z.string().uuid() });

async function guard(
  supabase: { from: (t: string) => any; rpc: (fn: string, args: any) => any },
  connectionId: string,
): Promise<{ organizationId: string; connectionId: string }> {
  const { data: conn, error } = await supabase
    .from("data_source_connections")
    .select("id, organization_id, source_type")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !conn) throw new Error("Connection not found");
  if (conn.source_type !== "further") throw new Error("Not a Further connection");
  const { data: allowed, error: rpcErr } = await supabase.rpc("can_manage_imports", {
    _org_id: conn.organization_id,
  });
  if (rpcErr || allowed !== true) throw new Error("Not permitted to manage this connection");
  return { organizationId: conn.organization_id, connectionId: conn.id };
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function loadKey(admin: any, connectionId: string): Promise<string> {
  const { data } = await admin
    .from("data_source_credentials")
    .select("secret_value")
    .eq("connection_id", connectionId)
    .maybeSingle();
  const key = data?.secret_value as string | undefined;
  if (!key) throw new Error("No Further Organization API Key is configured for this connection.");
  return key;
}

/** Stores/rotates the Further Organization API Key. Write-only value. */
export const furtherSaveCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ connectionId: z.string().uuid(), key: z.string().min(8).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { data: existing } = await admin
      .from("data_source_credentials")
      .select("id")
      .eq("connection_id", connectionId)
      .maybeSingle();
    const payload = {
      connection_id: connectionId,
      organization_id: organizationId,
      secret_ref: `further:${connectionId}`,
      credential_kind: "api_token",
      secret_value: data.key.trim(),
      rotated_at: new Date().toISOString(),
      last_verification_error: null,
    };
    if (existing?.id) {
      await admin.from("data_source_credentials").update(payload).eq("id", existing.id);
    } else {
      await admin.from("data_source_credentials").insert(payload);
    }
    await admin
      .from("data_source_connections")
      .update({ status: "needs_attention" })
      .eq("id", connectionId);
    return { ok: true };
  });

/** Reports whether a key exists plus a MASKED hint — never the key. */
export const furtherCredentialStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { maskKey } = await import("./api.server");
    const { data: cred } = await admin
      .from("data_source_credentials")
      .select("rotated_at, last_verified_at, last_verification_error, secret_value")
      .eq("connection_id", connectionId)
      .maybeSingle();
    const secret = cred?.secret_value as string | undefined;
    return {
      configured: !!secret,
      masked: secret ? maskKey(secret) : null,
      rotatedAt: (cred?.rotated_at as string | null) ?? null,
      lastVerifiedAt: (cred?.last_verified_at as string | null) ?? null,
      lastError: (cred?.last_verification_error as string | null) ?? null,
    };
  });

/** GET /api/v1/communities to verify key validity, scope and accessibility. */
export const furtherTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { furtherTest } = await import("./api.server");
    const key = await loadKey(admin, connectionId);
    const result = await furtherTest({ key });
    await admin
      .from("data_source_credentials")
      .update({
        last_verified_at: result.ok ? new Date().toISOString() : null,
        last_verification_error: result.ok ? null : result.message,
      })
      .eq("connection_id", connectionId);
    await admin
      .from("data_source_connections")
      .update({ status: result.ok ? "connected" : "needs_attention" })
      .eq("id", connectionId);
    return {
      ok: result.ok,
      communities: result.communities,
      status: result.status,
      message: result.ok ? `Connected to Further` : result.message,
    };
  });

/** Fetches Further communities and stores them for explicit mapping. */
export const furtherDiscoverCommunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { runFurtherSyncUnit } = await import("./sync.server");
    const { safeError } = await import("./api.server");
    const key = await loadKey(admin, connectionId);
    try {
      const { data: run } = await admin
        .from("source_sync_runs")
        .insert({
          organization_id: organizationId,
          connection_id: connectionId,
          status: "running",
          sync_cursor: { source: "further", datasets: ["communities"], trigger: "manual" },
        })
        .select("id")
        .single();
      const unit = await runFurtherSyncUnit(admin, { key }, {
        organizationId,
        connectionId,
        syncRunId: run.id as string,
        dataset: "communities",
        mode: "full",
      });
      await admin
        .from("source_sync_runs")
        .update({
          status: unit.status === "failed" ? "failed" : "success",
          completed_at: new Date().toISOString(),
          records_received: unit.rowsReceived,
          records_inserted: unit.rowsInserted,
          records_updated: unit.rowsUpdated,
          error_summary: unit.error,
        })
        .eq("id", run.id);
      return { ok: unit.status !== "failed", count: unit.rowsReceived, message: unit.error };
    } catch (err) {
      return { ok: false, count: 0, message: safeError(err) };
    }
  });

/**
 * Confirms a Further community -> canonical community mapping. Mapping is
 * always an explicit, deterministic act: nothing is auto-mapped by name.
 */
export const furtherConfirmMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        furtherCommunityId: z.string().min(1),
        furtherCommunityName: z.string().max(200).nullable().optional(),
        communityId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();

    if (data.communityId) {
      const { data: community } = await admin
        .from("communities")
        .select("id, organization_id")
        .eq("id", data.communityId)
        .maybeSingle();
      if (!community || community.organization_id !== organizationId) {
        throw new Error("Community does not belong to this organization");
      }
    }

    const { data: existing } = await admin
      .from("community_source_mappings")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_type", "further")
      .eq("external_id", data.furtherCommunityId)
      .maybeSingle();

    if (!data.communityId) {
      if (existing?.id) {
        await admin.from("community_source_mappings").update({ active: false }).eq("id", existing.id);
      }
      await admin
        .from("further_communities")
        .update({ community_id: null })
        .eq("connection_id", connectionId)
        .eq("further_community_id", data.furtherCommunityId);
      return { ok: true, mapped: false };
    }

    const payload = {
      organization_id: organizationId,
      community_id: data.communityId,
      source_type: "further",
      external_id: data.furtherCommunityId,
      external_name: data.furtherCommunityName ?? null,
      active: true,
    };
    if (existing?.id) {
      await admin.from("community_source_mappings").update(payload).eq("id", existing.id);
    } else {
      await admin.from("community_source_mappings").insert(payload);
    }
    await admin
      .from("further_communities")
      .update({ community_id: data.communityId })
      .eq("connection_id", connectionId)
      .eq("further_community_id", data.furtherCommunityId);
    return { ok: true, mapped: true };
  });

const datasetSchema = z.enum(FURTHER_DATASETS as unknown as [string, ...string[]]);

/**
 * Runs one bounded server-side sync slice. The browser only triggers it; all
 * work, progress and finalization happen server-side and survive tab closure.
 */
export const furtherRunSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        mode: z.enum(["full", "incremental"]).default("incremental"),
        scope: z.enum(["hourly", "nightly", "all"]).default("hourly"),
        datasets: z.array(datasetSchema).optional(),
        resumeRunId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { runFurtherSlice } = await import("./sync.server");
    const { safeError } = await import("./api.server");
    const key = await loadKey(admin, connectionId);

    const datasets = (data.datasets?.length
      ? data.datasets
      : data.scope === "nightly"
        ? FURTHER_NIGHTLY_DATASETS
        : data.scope === "all"
          ? FURTHER_DATASETS
          : FURTHER_HOURLY_DATASETS) as FurtherDataset[];

    try {
      const slice = await runFurtherSlice(admin, { key }, {
        organizationId,
        connectionId,
        datasets,
        mode: data.mode,
        trigger: "manual",
        resumeRunId: data.resumeRunId ?? null,
      });
      return {
        ok: slice.status !== "failed",
        status: slice.status,
        syncRunId: slice.syncRunId,
        remaining: slice.remaining,
        units: slice.units.map((u) => ({
          dataset: u.dataset,
          status: u.status,
          received: u.rowsReceived,
          inserted: u.rowsInserted,
          updated: u.rowsUpdated,
          failed: u.rowsFailed,
          unmapped: u.rowsUnmapped,
          error: u.error,
          warnings: u.warnings.slice(0, 5),
        })),
        message: slice.message,
      };
    } catch (err) {
      return {
        ok: false,
        status: "failed" as const,
        syncRunId: null,
        remaining: datasets,
        units: [],
        message: safeError(err),
      };
    }
  });

/** Retries only the datasets whose last unit failed — successful data is kept. */
export const furtherRetryFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { runFurtherSlice } = await import("./sync.server");
    const { safeError } = await import("./api.server");

    const { data: units } = await admin
      .from("further_sync_unit_runs")
      .select("dataset, status, started_at")
      .eq("connection_id", connectionId)
      .order("started_at", { ascending: false })
      .limit(60);
    const latest = new Map<string, string>();
    for (const u of (units ?? []) as any[]) {
      if (!latest.has(u.dataset)) latest.set(u.dataset, u.status);
    }
    const failed = [...latest.entries()]
      .filter(([, s]) => s === "failed" || s === "stalled" || s === "partial")
      .map(([d]) => d as FurtherDataset);

    if (!failed.length) {
      return { ok: true, status: "skipped" as const, datasets: [], message: "No failed work to retry." };
    }
    try {
      const key = await loadKey(admin, connectionId);
      const slice = await runFurtherSlice(admin, { key }, {
        organizationId,
        connectionId,
        datasets: failed,
        mode: "incremental",
        trigger: "manual",
      });
      return { ok: slice.status !== "failed", status: slice.status, datasets: failed, message: slice.message };
    } catch (err) {
      return { ok: false, status: "failed" as const, datasets: failed, message: safeError(err) };
    }
  });

/**
 * Validates the Further <-> WelcomeHome join against live data and writes
 * deterministic match evidence. No fuzzy matching is ever activated.
 */
export const furtherValidateMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { matchFurtherToWelcomeHome } = await import("./sync.server");
    const { safeError } = await import("./api.server");
    try {
      return { ok: true, report: await matchFurtherToWelcomeHome(admin, organizationId), message: null };
    } catch (err) {
      return { ok: false, report: null, message: safeError(err) };
    }
  });
