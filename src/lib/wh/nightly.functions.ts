/**
 * Admin-facing server functions for the nightly refresh + snapshot job.
 *
 * SECURITY: every function requires an authenticated session, resolves the
 * connection through the CALLER's RLS-scoped client, and additionally requires
 * can_manage_imports() for that organization before any privileged work runs.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function guard(supabase: any, connectionId: string) {
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
  return { organizationId: conn.organization_id as string, connectionId: conn.id as string };
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Starts (or joins) tonight's run and processes one bounded slice. */
export const whNightlyRunNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        communityIds: z.array(z.string().uuid()).optional(),
        maxCommunities: z.number().int().min(1).max(5).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { ensureNightlyRun, tickNightlyRun } = await import("./nightly.server");

    const ensured = await ensureNightlyRun(admin, {
      organizationId,
      connectionId,
      triggeredBy: "manual",
      triggeredByUser: (context as any).userId ?? null,
      communityIds: data.communityIds ?? null,
    });
    if (!ensured.runId) {
      return { ok: false as const, runId: null, message: "No active WelcomeHome community mappings.", tick: null };
    }
    const tick = await tickNightlyRun(admin, ensured.runId, {
      maxCommunities: data.maxCommunities ?? 2,
    });
    return { ok: true as const, runId: ensured.runId, message: null as string | null, tick };
  });

/** Continues an in-flight run with one more bounded slice. */
export const whNightlyTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        runId: z.string().uuid(),
        maxCommunities: z.number().int().min(1).max(5).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { data: run } = await admin
      .from("wh_nightly_runs")
      .select("id")
      .eq("id", data.runId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!run) throw new Error("Nightly run not found for this organization");
    const { tickNightlyRun } = await import("./nightly.server");
    return await tickNightlyRun(admin, data.runId, { maxCommunities: data.maxCommunities ?? 2 });
  });

/** Cancels an in-flight run. Snapshots already written are untouched. */
export const whNightlyCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ connectionId: z.string().uuid(), runId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { error } = await admin
      .from("wh_nightly_runs")
      .update({ status: "canceled", finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null })
      .eq("id", data.runId)
      .eq("organization_id", organizationId)
      .in("status", ["queued", "running"]);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
