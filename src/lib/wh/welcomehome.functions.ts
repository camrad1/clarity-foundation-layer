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
import { WH_ALL_TABLES, WH_CORE_TABLES, WH_LOOKUP_SOURCE, type WhTable } from "./tables";

const connectionInput = z.object({ connectionId: z.string().uuid() });

/** Minutes without a persisted heartbeat before a work unit counts as stalled. */
export const WH_STALL_MINUTES = 10;

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

/**
 * SCALABLE SYNC ORCHESTRATION
 * ---------------------------
 * A portfolio sync is NEVER one HTTP request. `whPlanSync` creates a parent run
 * and returns the bounded work units (one source table x one mapped community,
 * plus account-wide lookup datasets fetched once). The browser then calls
 * `whRunSyncUnit` for each unit — each of which is individually authorized
 * server-side and uses the server-held API token — and finally `whFinalizeSync`
 * to aggregate the parent status. Request duration therefore depends on one
 * dataset for one community, not on portfolio size.
 */

type MappedTarget = { communityId: string; sourceCommunityId: string; timezone: string | null; name: string };

/** Active WelcomeHome mappings for the organization. This is the ONLY source of
 *  external community IDs — a caller can never submit an arbitrary one. */
async function mappedTargets(admin: any, organizationId: string): Promise<MappedTarget[]> {
  const { data: mappings } = await admin
    .from("community_source_mappings")
    .select("external_id, community_id, communities(id, name, timezone, organization_id)")
    .eq("organization_id", organizationId)
    .eq("source_type", "welcomehome")
    .eq("active", true);
  return (mappings ?? [])
    .filter((m: any) => m.communities?.organization_id === organizationId)
    .map((m: any) => ({
      communityId: m.community_id as string,
      sourceCommunityId: String(m.external_id),
      timezone: (m.communities?.timezone as string | null) ?? null,
      name: (m.communities?.name as string | null) ?? "Community",
    }));
}

export type WhWorkUnit = {
  key: string;
  table: string;
  /** null = account-wide dataset (fetched once, not once per community). */
  communityId: string | null;
  communityName: string | null;
  scope: "community" | "account";
};

function buildUnits(tables: string[], targets: MappedTarget[]): WhWorkUnit[] {
  const units: WhWorkUnit[] = [];
  for (const table of tables) {
    const lookup = (WH_LOOKUP_SOURCE as Record<string, { kind: string }>)[table];
    // Account-wide JSON lookups are fetched once per run, never once per
    // community. Community-scoped datasets (all core tables and the Referrers
    // export) get one unit per mapped community.
    if (lookup && lookup.kind === "json") {
      units.push({ key: `${table}:*`, table, communityId: null, communityName: null, scope: "account" });
      continue;
    }
    for (const t of targets) {
      units.push({
        key: `${table}:${t.communityId}`,
        table,
        communityId: t.communityId,
        communityName: t.name,
        scope: "community",
      });
    }
  }
  return units;
}

/**
 * Creates (or resumes) a parent sync run and returns the work units still to
 * do. Resuming never repeats units that already completed successfully in that
 * run, and community scope is always explicit — "all mapped communities" is a
 * choice the caller makes, never a silent default.
 */
export const whPlanSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        mode: z.enum(["full", "incremental"]),
        /** null/absent = every mapped community; otherwise an explicit subset. */
        communityIds: z.array(z.string().uuid()).optional(),
        tables: z.array(z.string()).optional(),
        /** Resume/retry an existing parent run instead of starting a new one. */
        resumeRunId: z.string().uuid().optional(),
        /** Resume mode: skip units that already succeeded in that run. */
        retryFailedOnly: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();

    // Never plan on top of an abandoned run: reap stalled units first so any
    // previous run is finalized honestly instead of lingering as `running`.
    await admin.rpc("wh_sync_reap_stalled", {
      _org_id: organizationId,
      _stall_minutes: WH_STALL_MINUTES,
    });

    const all = await mappedTargets(admin, organizationId);
    const targets = data.communityIds?.length
      ? all.filter((t) => data.communityIds!.includes(t.communityId))
      : all;

    if (!targets.length) {
      return {
        ok: false as const,
        syncRunId: null as string | null,
        units: [] as WhWorkUnit[],
        skipped: [] as WhWorkUnit[],
        message: all.length
          ? "None of the selected communities has an active WelcomeHome mapping."
          : "No active WelcomeHome community mappings. Map at least one community before syncing.",
      };
    }

    const requested = (data.tables?.length ? data.tables : WH_ALL_TABLES) as WhTable[];
    const tables = requested.filter((t) => (WH_ALL_TABLES as string[]).includes(t));
    let units = buildUnits(tables, targets);

    let syncRunId: string;
    if (data.resumeRunId) {
      const { data: parent } = await admin
        .from("source_sync_runs")
        .select("id")
        .eq("id", data.resumeRunId)
        .eq("organization_id", organizationId)
        .eq("connection_id", connectionId)
        .maybeSingle();
      if (!parent) throw new Error("Sync run not found for this connection");
      syncRunId = parent.id as string;
    } else {
      const { data: run, error } = await admin
        .from("source_sync_runs")
        .insert({
          organization_id: organizationId,
          connection_id: connectionId,
          status: "queued",
          sync_cursor: {
            mode: data.mode,
            tables,
            communityIds: targets.map((t) => t.communityId),
            totalUnits: units.length,
          },
        })
        .select("id")
        .single();
      if (error || !run) throw new Error(`Unable to start sync run: ${error?.message ?? "unknown"}`);
      syncRunId = run.id as string;
    }

    // Successful (or permanently unsupported) units are never redone on a
    // resume — data already in the warehouse stays untouched.
    let skipped: WhWorkUnit[] = [];
    if (data.resumeRunId && data.retryFailedOnly !== false) {
      const { data: done } = await admin
        .from("wh_sync_table_runs")
        .select("source_table, community_id, status")
        .eq("sync_run_id", syncRunId)
        .in("status", ["success", "unsupported"]);
      const doneKeys = new Set(
        (done ?? []).map((r: any) => `${r.source_table}:${r.community_id ?? "*"}`),
      );
      skipped = units.filter((u) => doneKeys.has(u.key));
      units = units.filter((u) => !doneKeys.has(u.key));
    }

    await admin
      .from("source_sync_runs")
      .update({ status: "running" })
      .eq("id", syncRunId);
    await admin
      .from("data_source_connections")
      .update({ status: "syncing", last_attempted_sync_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("organization_id", organizationId);

    return { ok: true as const, syncRunId, units, skipped, message: null as string | null };
  });

/**
 * Runs exactly ONE bounded work unit. Security: the caller must be able to
 * manage the connection (guard), the parent run must belong to the same
 * organization AND connection, and the requested canonical community must have
 * an active WelcomeHome mapping in that organization — the external WelcomeHome
 * ID is read from that mapping, never from the request.
 */
export const whRunSyncUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        syncRunId: z.string().uuid(),
        mode: z.enum(["full", "incremental"]),
        table: z.string(),
        communityId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();

    if (!(WH_ALL_TABLES as string[]).includes(data.table)) throw new Error("Unknown source table");

    const { data: parent } = await admin
      .from("source_sync_runs")
      .select("id")
      .eq("id", data.syncRunId)
      .eq("organization_id", organizationId)
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (!parent) throw new Error("Sync run not found for this connection");

    const all = await mappedTargets(admin, organizationId);
    let target: MappedTarget | null = null;
    if (data.communityId) {
      target = all.find((t) => t.communityId === data.communityId) ?? null;
      if (!target) throw new Error("Community has no active WelcomeHome mapping in this organization");
    } else {
      const lookup = (WH_LOOKUP_SOURCE as Record<string, { kind: string }>)[data.table];
      if (!lookup || lookup.kind !== "json") {
        throw new Error("This dataset is community-scoped and requires a mapped community");
      }
    }

    const { data: settings } = await admin
      .from("wh_settings")
      .select("incremental_overlap_minutes")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const { runWelcomeHomeSyncUnit } = await import("./sync.server");
    const token = await loadToken(admin, connectionId);

    const result = await runWelcomeHomeSyncUnit(
      admin,
      { token },
      {
        organizationId,
        connectionId,
        syncRunId: data.syncRunId,
        table: data.table as WhTable,
        target: target
          ? {
              communityId: target.communityId,
              sourceCommunityId: target.sourceCommunityId,
              timezone: target.timezone,
            }
          : null,
        mode: data.mode,
        overlapMinutes: settings?.incremental_overlap_minutes ?? 120,
      },
    );

    return {
      table: result.table,
      communityId: data.communityId ?? null,
      status: result.status,
      rowsReceived: result.rowsReceived,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsFailed: result.rowsFailed,
      pagesFetched: result.pagesFetched,
      durationMs: result.durationMs,
      error: result.error,
      warnings: result.warnings,
    };
  });

/**
 * Aggregates the child work units into an honest parent status. A run is only
 * `success` when every requested unit completed cleanly (or is permanently
 * unsupported); anything else is `partial`, and a run where no core unit landed
 * data is `failed`. An interrupted browser simply leaves the run `running`
 * until it is resumed — never falsely complete.
 */
export const whFinalizeSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        syncRunId: z.string().uuid(),
        expectedUnits: z.number().int().min(0),
        canceled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();

    const { data: children } = await admin
      .from("wh_sync_table_runs")
      .select("source_table, community_id, status, rows_received, rows_inserted, rows_updated, rows_failed, source_max_updated_at, error_summary")
      .eq("sync_run_id", data.syncRunId)
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: true });

    const rows = (children ?? []) as any[];
    // De-duplicate retries: the latest attempt per unit key wins.
    const latest = new Map<string, any>();
    for (const r of rows) latest.set(`${r.source_table}:${r.community_id ?? "*"}`, r);
    const units = [...latest.values()];

    // A unit still claimed (running) or reaped as stalled is NOT a completed
    // unit: it can never make the parent run Complete.
    const nonTerminal = units.filter((r) => r.status === "running" || r.status === "pending");
    const stalled = units.filter((r) => r.status === "stalled");
    const core = units.filter((r) => (WH_CORE_TABLES as readonly string[]).includes(r.source_table));
    const coreOk = core.filter((r) => r.status === "success" || r.status === "partial");
    const allClean = units.every((r) => r.status === "success" || r.status === "unsupported");
    const complete =
      units.filter((r) => r.status !== "running" && r.status !== "pending").length >=
        data.expectedUnits && nonTerminal.length === 0 && stalled.length === 0;



    const status = data.canceled
      ? "canceled"
      : core.length > 0 && coreOk.length === 0
        ? "failed"
        : allClean && complete
          ? "success"
          : "partial";

    const totals = units.reduce(
      (a, r) => ({
        received: a.received + (r.rows_received ?? 0),
        inserted: a.inserted + (r.rows_inserted ?? 0),
        updated: a.updated + (r.rows_updated ?? 0),
        failed: a.failed + (r.rows_failed ?? 0),
      }),
      { received: 0, inserted: 0, updated: 0, failed: 0 },
    );

    await admin
      .from("source_sync_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        records_received: totals.received,
        records_inserted: totals.inserted,
        records_updated: totals.updated,
        records_failed: totals.failed,
        error_summary:
          units
            .filter((r) => r.error_summary)
            .map((r) => `${r.source_table}${r.community_id ? "" : " (account-wide)"}: ${r.error_summary}`)
            .join(" | ")
            .slice(0, 1000) || null,
      })
      .eq("id", data.syncRunId);

    const through = units
      .map((r) => r.source_max_updated_at as string | null)
      .filter((d): d is string => !!d)
      .sort();

    await admin
      .from("data_source_connections")
      .update({
        status: status === "failed" ? "needs_attention" : "connected",
        last_attempted_sync_at: new Date().toISOString(),
        ...(status === "success" || status === "partial"
          ? { last_successful_sync_at: new Date().toISOString() }
          : {}),
        ...(through.length ? { data_through_date: String(through[through.length - 1]).slice(0, 10) } : {}),
      })
      .eq("id", connectionId)
      .eq("organization_id", organizationId);

    return { status, totals, unitsCompleted: units.length, expectedUnits: data.expectedUnits };
  });

/**
 * STALLED-WORK REAPER.
 *
 * A work unit heartbeats (`last_progress_at`) every time a page of source rows
 * is fetched AND persisted. This function marks any non-terminal unit that has
 * not heartbeat inside the window as `stalled`, then finalizes parent runs
 * whose entire unit set has stopped advancing — as `partial` when other units
 * succeeded, `failed` when none did. A slow-but-healthy unit keeps beating and
 * is never touched, so the cure is progress-based, not timeout-based.
 */
export const whReapStalled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        stallMinutes: z.number().int().min(1).max(240).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { data: result, error } = await admin.rpc("wh_sync_reap_stalled", {
      _org_id: organizationId,
      _stall_minutes: data.stallMinutes ?? WH_STALL_MINUTES,
    });
    if (error) throw new Error(error.message);
    const payload = (result ?? {}) as { stalled_units?: number; finalized_runs?: unknown[] };
    return {
      stalledUnits: payload.stalled_units ?? 0,
      finalizedRuns: (payload.finalized_runs ?? []) as {
        run_id: string;
        status: string;
        successful: number;
        failed_or_stalled: number;
        planned: number;
        never_started: number;
      }[],
    };
  });




/**
 * Replays rows already captured in source_records_raw through the current
 * normalizers, without calling WelcomeHome again. This is how a normalization
 * fix is validated against the exact payloads that previously failed — the raw
 * rows are read, never deleted, so the evidence stays intact.
 */
export const whReprocessRaw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        table: z.string().optional(),
        limit: z.number().int().min(1).max(20000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, connectionId } = await guard(context.supabase as any, data.connectionId);
    const admin = await adminClient();
    const { NORMALIZERS } = await import("./normalize.server");
    const { WH_CORE_DESTINATION } = await import("./tables");

    const { data: mappings } = await admin
      .from("community_source_mappings")
      .select("external_id, community_id, communities(id, timezone, organization_id)")
      .eq("organization_id", organizationId)
      .eq("source_type", "welcomehome")
      .eq("active", true);
    const byExternal = new Map<string, { communityId: string; timezone: string | null }>();
    for (const m of mappings ?? []) {
      const row = m as any;
      if (row.communities?.organization_id !== organizationId) continue;
      byExternal.set(String(row.external_id), {
        communityId: row.community_id as string,
        timezone: (row.communities?.timezone as string | null) ?? null,
      });
    }

    let query = admin
      .from("source_records_raw")
      .select("id, record_type, payload, source_community_external_id, community_id")
      .eq("connection_id", connectionId)
      .eq("source_type", "welcomehome")
      .order("created_at", { ascending: true })
      .limit(data.limit ?? 5000);
    if (data.table) query = query.eq("record_type", data.table);
    const { data: raws, error } = await query;
    if (error) throw new Error(error.message);

    const perTable: Record<string, { attempted: number; recovered: number; stillFailing: number }> =
      {};

    const buckets = new Map<string, any[]>();
    for (const r of raws ?? []) {
      const row = r as any;
      const table = String(row.record_type);
      if (!(table in NORMALIZERS)) continue;
      const stat = (perTable[table] ??= { attempted: 0, recovered: 0, stillFailing: 0 });
      stat.attempted += 1;
      const scope = byExternal.get(String(row.source_community_external_id ?? ""));
      try {
        const normalized = (NORMALIZERS as any)[table](row.payload as Record<string, string>, {
          organizationId,
          connectionId,
          communityId: scope?.communityId ?? (row.community_id as string | null),
          timezone: scope?.timezone ?? null,
        });
        if (!normalized.source_id) {
          stat.stillFailing += 1;
          continue;
        }
        const list = buckets.get(table) ?? [];
        list.push(normalized);
        buckets.set(table, list);
      } catch {
        stat.stillFailing += 1;
      }
    }

    for (const [table, rows] of buckets) {
      const destination = (WH_CORE_DESTINATION as Record<string, string>)[table];
      if (!destination) continue;
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const { error: upErr } = await admin
          .from(destination)
          .upsert(slice, { onConflict: "connection_id,source_id" });
        if (upErr) {
          perTable[table]!.stillFailing += slice.length;
          continue;
        }
        perTable[table]!.recovered += slice.length;
      }
    }

    return { ok: true, tables: perTable };
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
