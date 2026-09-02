/**
 * WelcomeHome server functions.
 *
 * SECURITY MODEL
 * --------------
 * 1. Every function requires an authenticated Supabase session.
 * 2. The caller-supplied connection id is resolved through the CALLER's own
 *    RLS-scoped client, so a caller can never pass another organization's
 *    connection id to reach data they cannot see.
 * 3. The caller must additionally pass can_manage_imports() for that
 *    organization before any credential or sync operation runs.
 * 4. Only after both checks does the privileged service-role client load the
 *    API token and perform ingestion.
 * 5. The token is never returned to the browser and never logged.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WH_ALL_TABLES, WH_CORE_TABLES, type WhTable } from "./tables";

const connectionInput = z.object({ connectionId: z.string().uuid() });

type Guarded = {
  organizationId: string;
  connectionId: string;
};

/** Resolves + authorizes the connection using the caller's RLS-scoped client. */
async function guard(
  supabase: { from: (t: string) => any; rpc: (fn: string, args: any) => any },
  connectionId: string,
): Promise<Guarded> {
  const { data: conn, error } = await supabase
    .from("data_source_connections")
    .select("id, organization_id, source_type")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !conn) throw new Error("Connection not found");
  if (conn.source_type !== "welcomehome") throw new Error("Not a WelcomeHome connection");
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

async function loadToken(admin: any, connectionId: string): Promise<string> {
  const { data } = await admin
    .from("data_source_credentials")
    .select("secret_value")
    .eq("connection_id", connectionId)
    .maybeSingle();
  const token = data?.secret_value as string | undefined;
  if (!token) throw new Error("No WelcomeHome API token is configured for this connection.");
  return token;
}

/** Stores/rotates the WelcomeHome API token. The value is write-only. */
export const whSaveCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ connectionId: z.string().uuid(), token: z.string().min(8).max(500) }).parse(d),
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
      secret_ref: `welcomehome:${connectionId}`,
      credential_kind: "api_token",
      secret_value: data.token.trim(),
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

/** Reports whether a token exists — never the token itself. */
export const whCredentialStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { data: cred } = await admin
      .from("data_source_credentials")
      .select("rotated_at, last_verified_at, last_verification_error, secret_value")
      .eq("connection_id", connectionId)
      .maybeSingle();
    return {
      configured: !!cred?.secret_value,
      rotatedAt: (cred?.rotated_at as string | null) ?? null,
      lastVerifiedAt: (cred?.last_verified_at as string | null) ?? null,
      lastError: (cred?.last_verification_error as string | null) ?? null,
    };
  });

/** GET /api/ping through the server. */
export const whTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { whPing } = await import("./api.server");
    const token = await loadToken(admin, connectionId);
    const result = await whPing({ token });
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
    return { ok: result.ok, message: result.ok ? "Connection verified." : result.message };
  });

/** GET /api/communities and store discovery results for mapping. */
export const whDiscoverCommunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { whCommunities, safeError } = await import("./api.server");
    const token = await loadToken(admin, connectionId);
    try {
      const communities = await whCommunities({ token });
      if (communities.length) {
        await admin.from("wh_source_communities").upsert(
          communities.map((c) => ({
            organization_id: organizationId,
            connection_id: connectionId,
            source_id: c.source_id,
            name: c.name,
            payload: c.payload,
            discovered_at: new Date().toISOString(),
          })),
          { onConflict: "connection_id,source_id" },
        );
      }
      return { ok: true, count: communities.length, message: null as string | null };
    } catch (err) {
      return { ok: false, count: 0, message: safeError(err) };
    }
  });

/** Probes Daily Snapshot availability without ingesting snapshot data. */
export const whCheckDailySnapshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { whDailySnapshotState } = await import("./api.server");
    const token = await loadToken(admin, connectionId);
    const state = await whDailySnapshotState({ token });
    await admin
      .from("wh_settings")
      .upsert(
        { organization_id: organizationId, daily_snapshots_state: state },
        { onConflict: "organization_id" },
      );
    return { state };
  });

/** Full or incremental synchronization. */
export const whRunSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        mode: z.enum(["full", "incremental"]),
        tables: z.array(z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { runWelcomeHomeSync } = await import("./sync.server");
    const token = await loadToken(admin, connectionId);

    // Canonical community mappings decide what may be ingested. An unmapped
    // WelcomeHome community is never pulled, so it can never contaminate a
    // mapped community's KPI.
    const { data: mappings } = await admin
      .from("community_source_mappings")
      .select("external_id, community_id, communities(id, timezone, organization_id)")
      .eq("organization_id", organizationId)
      .eq("source_type", "welcomehome")
      .eq("active", true);

    const targets = (mappings ?? [])
      .filter((m: any) => m.communities?.organization_id === organizationId)
      .map((m: any) => ({
        communityId: m.community_id as string,
        sourceCommunityId: String(m.external_id),
        timezone: (m.communities?.timezone as string | null) ?? null,
      }));

    if (!targets.length) {
      return {
        ok: false,
        status: "failed" as const,
        syncRunId: null as string | null,
        results: [],
        message:
          "No active WelcomeHome community mappings. Map at least one community before syncing.",
      };
    }

    const { data: settings } = await admin
      .from("wh_settings")
      .select("incremental_overlap_minutes")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const requested = (data.tables?.length ? data.tables : WH_ALL_TABLES) as WhTable[];
    const tables = requested.filter((t) => (WH_ALL_TABLES as string[]).includes(t));

    const outcome = await runWelcomeHomeSync(
      admin,
      { token },
      {
        organizationId,
        connectionId,
        mode: data.mode,
        tables,
        targets,
        overlapMinutes: settings?.incremental_overlap_minutes ?? 120,
      },
    );

    const failedCore = outcome.results.filter(
      (r) => r.status === "failed" && (WH_CORE_TABLES as readonly string[]).includes(r.table),
    );

    return {
      ok: outcome.status !== "failed",
      status: outcome.status,
      syncRunId: outcome.syncRunId,
      results: outcome.results,
      message: failedCore.length
        ? `Core table(s) failed: ${failedCore.map((r) => r.table).join(", ")}`
        : null,
    };
  });

/** Seeds mapping rows for newly discovered activity types and scores. */
export const whSeedMappingRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();

    const { data: lookups } = await admin
      .from("wh_lookups")
      .select("lookup_type, source_id, label")
      .eq("connection_id", connectionId)
      .in("lookup_type", ["activity_type", "score"]);

    const activityRows = (lookups ?? [])
      .filter((l: any) => l.lookup_type === "activity_type")
      .map((l: any) => ({
        organization_id: organizationId,
        connection_id: connectionId,
        activity_type_id: l.source_id,
        activity_type_label: l.label,
      }));
    const scoreRows = (lookups ?? [])
      .filter((l: any) => l.lookup_type === "score")
      .map((l: any) => ({
        organization_id: organizationId,
        connection_id: connectionId,
        score_id: l.source_id,
        score_label: l.label,
      }));

    if (activityRows.length) {
      await admin
        .from("wh_activity_type_mappings")
        .upsert(activityRows, { onConflict: "connection_id,activity_type_id", ignoreDuplicates: true });
    }
    if (scoreRows.length) {
      await admin
        .from("wh_score_mappings")
        .upsert(scoreRows, { onConflict: "connection_id,score_id", ignoreDuplicates: true });
    }
    return { activityTypes: activityRows.length, scores: scoreRows.length };
  });
