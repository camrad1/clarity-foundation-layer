/**
 * NIGHTLY WELCOMEHOME REFRESH + IMMUTABLE DAILY SNAPSHOT WORKER.
 *
 * DESIGN RULES
 * ------------
 * 1. BOUNDED WORK. A tick processes at most `maxCommunities` communities, and
 *    each community is a small fixed set of existing bounded sync work units
 *    (`runWelcomeHomeSyncUnit`). Request duration never scales with portfolio
 *    size; the scheduler simply ticks again until the night is finished.
 * 2. SINGLE FLIGHT. Every tick must hold a database lease (`wh_nightly_claim`).
 *    A concurrent scheduler tick or a manual "Run now" joins the same run
 *    instead of racing it. A crashed worker's lease expires and the next tick
 *    resumes the same run.
 * 3. IDEMPOTENT PROGRESS. Progress is recorded per community in
 *    `wh_nightly_units`, so a resumed run never redoes finished communities.
 * 4. HONEST SNAPSHOTS. A snapshot is written ONLY after the required
 *    current-state datasets refreshed cleanly for that community. Otherwise a
 *    failure row is recorded with the reason — never a fabricated or
 *    carried-forward occupancy number.
 * 5. NO BACKFILL. Snapshots are only ever written for the community's own
 *    local "today". History is never reconstructed from current-state rows.
 */

import { WH_ALL_TABLES, type WhTable } from "./tables";

type Admin = any;

/** Datasets that must be fresh before a snapshot may be written. */
export const NIGHTLY_REQUIRED_TABLES: WhTable[] = ["Units", "HousingContracts"] as WhTable[];

export type NightlyTarget = {
  communityId: string;
  sourceCommunityId: string;
  timezone: string | null;
  name: string;
};

export async function nightlyTargets(admin: Admin, organizationId: string): Promise<NightlyTarget[]> {
  const { data } = await admin
    .from("community_source_mappings")
    .select("external_id, community_id, communities(id, name, timezone, organization_id)")
    .eq("organization_id", organizationId)
    .eq("source_type", "welcomehome")
    .eq("active", true);
  return (data ?? [])
    .filter((m: any) => m.communities?.organization_id === organizationId)
    .map((m: any) => ({
      communityId: m.community_id as string,
      sourceCommunityId: String(m.external_id),
      timezone: (m.communities?.timezone as string | null) ?? null,
      name: (m.communities?.name as string | null) ?? "Community",
    }));
}

/** Local calendar date for a community — snapshots are dated in local time. */
export function localDate(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Local hour (0–23) for a community, used to keep the job inside its own night. */
export function localHour(timezone: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone || "UTC",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
  } catch {
    return new Date().getUTCHours();
  }
}


export type EnsureResult = {
  runId: string | null;
  created: boolean;
  reason?: string;
  communities: number;
};

/**
 * Returns the active nightly run for the organization, creating it (with one
 * work item per mapped community) when none is in flight.
 */
export async function ensureNightlyRun(
  admin: Admin,
  args: {
    organizationId: string;
    connectionId: string;
    triggeredBy: "schedule" | "manual";
    triggeredByUser?: string | null;
    communityIds?: string[] | null;
  },
): Promise<EnsureResult> {
  const { data: active } = await admin
    .from("wh_nightly_runs")
    .select("id, communities_total")
    .eq("organization_id", args.organizationId)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (active) {
    return { runId: active.id as string, created: false, reason: "already_running", communities: active.communities_total ?? 0 };
  }

  let targets = await nightlyTargets(admin, args.organizationId);
  if (args.communityIds?.length) {
    targets = targets.filter((t) => args.communityIds!.includes(t.communityId));
  }
  if (!targets.length) {
    return { runId: null, created: false, reason: "no_mapped_communities", communities: 0 };
  }

  if (args.triggeredBy === "schedule") {
    // The scheduler ticks frequently; a community only enters a run when it is
    // inside its own local overnight window AND has no snapshot for its local
    // date yet. That makes repeated ticks cheap and idempotent, and keeps the
    // snapshot anchored to local time rather than the scheduler's clock.
    const { data: existing } = await admin
      .from("community_daily_snapshots")
      .select("community_id, snapshot_date")
      .eq("organization_id", args.organizationId)
      .eq("status", "success")
      .in("community_id", targets.map((t) => t.communityId));
    const done = new Set(
      ((existing ?? []) as { community_id: string; snapshot_date: string }[]).map(
        (r) => `${r.community_id}:${r.snapshot_date}`,
      ),
    );
    targets = targets.filter((t) => {
      const hour = localHour(t.timezone);
      const inWindow = hour >= 1 && hour <= 5;
      return inWindow && !done.has(`${t.communityId}:${localDate(t.timezone)}`);
    });
    if (!targets.length) {
      return { runId: null, created: false, reason: "nothing_due", communities: 0 };
    }
  }

  const { data: run, error } = await admin
    .from("wh_nightly_runs")
    .insert({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      status: "queued",
      triggered_by: args.triggeredBy,
      triggered_by_user: args.triggeredByUser ?? null,
      communities_total: targets.length,
    })
    .select("id")
    .single();
  if (error || !run) {
    // A concurrent creator won the unique active-run index — join their run.
    const { data: other } = await admin
      .from("wh_nightly_runs")
      .select("id, communities_total")
      .eq("organization_id", args.organizationId)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (other) return { runId: other.id as string, created: false, reason: "already_running", communities: other.communities_total ?? 0 };
    throw new Error(`Unable to start nightly run: ${error?.message ?? "unknown"}`);
  }

  await admin.from("wh_nightly_units").insert(
    targets.map((t) => ({
      run_id: run.id,
      organization_id: args.organizationId,
      community_id: t.communityId,
      status: "pending",
    })),
  );

  return { runId: run.id as string, created: true, communities: targets.length };
}

export type TickResult = {
  runId: string;
  claimed: boolean;
  processed: number;
  snapshots: number;
  failed: number;
  remaining: number;
  status: string;
  details: { community: string; status: string; snapshotDate?: string | null; error?: string | null }[];
};

/**
 * Processes a bounded slice of one nightly run. Safe to call repeatedly: the
 * lease guarantees only one worker at a time, and finished communities are
 * never reprocessed.
 */
export async function tickNightlyRun(
  admin: Admin,
  runId: string,
  opts?: { maxCommunities?: number; leaseSeconds?: number },
): Promise<TickResult> {
  const maxCommunities = Math.max(1, Math.min(opts?.maxCommunities ?? 2, 5));
  const leaseSeconds = opts?.leaseSeconds ?? 300;

  const empty = (status: string): TickResult => ({
    runId, claimed: false, processed: 0, snapshots: 0, failed: 0, remaining: 0, status, details: [],
  });

  const { data: run } = await admin
    .from("wh_nightly_runs")
    .select("id, organization_id, connection_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return empty("not_found");
  if (!["queued", "running"].includes(run.status)) return empty(run.status);

  const { data: token } = await admin.rpc("wh_nightly_claim", {
    _run_id: runId,
    _lease_seconds: leaseSeconds,
  });
  if (!token) return empty("leased_elsewhere");

  const details: TickResult["details"] = [];
  let processed = 0;
  let snapshots = 0;
  let failed = 0;

  try {
    const { data: cred } = await admin
      .from("data_source_credentials")
      .select("secret_value")
      .eq("connection_id", run.connection_id)
      .maybeSingle();
    const apiToken = cred?.secret_value as string | undefined;
    if (!apiToken) throw new Error("No WelcomeHome API token is configured for this connection.");

    const { data: settings } = await admin
      .from("wh_settings")
      .select("incremental_overlap_minutes")
      .eq("organization_id", run.organization_id)
      .maybeSingle();

    const targets = await nightlyTargets(admin, run.organization_id);
    const { runWelcomeHomeSyncUnit } = await import("./sync.server");

    for (let i = 0; i < maxCommunities; i++) {
      const { data: unitId } = await admin.rpc("wh_nightly_claim_unit", {
        _run_id: runId,
        _lease_token: token,
      });
      if (!unitId) break;

      const { data: unit } = await admin
        .from("wh_nightly_units")
        .select("id, community_id")
        .eq("id", unitId)
        .single();
      const target = targets.find((t) => t.communityId === unit.community_id) ?? null;
      const snapshotDate = localDate(target?.timezone ?? null);
      processed += 1;

      if (!target) {
        await admin.rpc("wh_record_snapshot_failure", {
          _org_id: run.organization_id,
          _community_id: unit.community_id,
          _reason: "Community no longer has an active WelcomeHome mapping.",
          _snapshot_date: snapshotDate,
        });
        await admin
          .from("wh_nightly_units")
          .update({ status: "skipped", error: "No active WelcomeHome mapping", finished_at: new Date().toISOString() })
          .eq("id", unitId);
        failed += 1;
        details.push({ community: unit.community_id, status: "skipped", error: "No active mapping" });
        continue;
      }

      // Parent sync run for this community's nightly refresh.
      const { data: syncRun } = await admin
        .from("source_sync_runs")
        .insert({
          organization_id: run.organization_id,
          connection_id: run.connection_id,
          status: "running",
          sync_cursor: {
            mode: "full",
            nightly: true,
            nightlyRunId: runId,
            tables: NIGHTLY_REQUIRED_TABLES,
            communityIds: [target.communityId],
          },
        })
        .select("id")
        .single();

      const problems: string[] = [];
      for (const table of NIGHTLY_REQUIRED_TABLES) {
        if (!(WH_ALL_TABLES as string[]).includes(table)) continue;
        try {
          const res = await runWelcomeHomeSyncUnit(
            admin,
            { token: apiToken },
            {
              organizationId: run.organization_id,
              connectionId: run.connection_id,
              syncRunId: syncRun.id,
              table,
              target: {
                communityId: target.communityId,
                sourceCommunityId: target.sourceCommunityId,
                timezone: target.timezone,
              },
              // Current-state datasets are refreshed in full so the snapshot
              // reflects the true present position, not a partial delta.
              mode: "full",
              overlapMinutes: settings?.incremental_overlap_minutes ?? 120,
            },
          );
          if (res.status !== "success") {
            problems.push(`${table}: ${res.status}${res.error ? ` — ${res.error}` : ""}`);
          }
        } catch (err) {
          problems.push(`${table}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }

      await admin
        .from("source_sync_runs")
        .update({
          status: problems.length ? "partial" : "success",
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncRun.id);

      if (problems.length) {
        const reason = `Required datasets did not refresh cleanly — ${problems.join("; ")}`;
        await admin.rpc("wh_record_snapshot_failure", {
          _org_id: run.organization_id,
          _community_id: target.communityId,
          _reason: reason,
          _snapshot_date: snapshotDate,
          _sync_run_id: syncRun.id,
          _connection_id: run.connection_id,
        });
        await admin
          .from("wh_nightly_units")
          .update({
            status: "failed",
            error: reason.slice(0, 500),
            sync_run_id: syncRun.id,
            snapshot_date: snapshotDate,
            finished_at: new Date().toISOString(),
          })
          .eq("id", unitId);
        failed += 1;
        details.push({ community: target.name, status: "failed", error: reason });
        continue;
      }

      const { data: written, error: snapErr } = await admin.rpc("wh_write_daily_snapshot", {
        _org_id: run.organization_id,
        _community_id: target.communityId,
        _snapshot_date: snapshotDate,
        _sync_run_id: syncRun.id,
        _connection_id: run.connection_id,
        _source_through: new Date().toISOString(),
      });

      if (snapErr) {
        await admin
          .from("wh_nightly_units")
          .update({
            status: "failed",
            error: String(snapErr.message ?? snapErr).slice(0, 500),
            sync_run_id: syncRun.id,
            finished_at: new Date().toISOString(),
          })
          .eq("id", unitId);
        failed += 1;
        details.push({ community: target.name, status: "failed", error: String(snapErr.message ?? snapErr) });
        continue;
      }

      if (written?.created) snapshots += 1;
      await admin
        .from("wh_nightly_units")
        .update({
          status: "done",
          error: null,
          sync_run_id: syncRun.id,
          snapshot_date: snapshotDate,
          finished_at: new Date().toISOString(),
        })
        .eq("id", unitId);
      details.push({
        community: target.name,
        status: written?.created ? "snapshotted" : "already_snapshotted",
        snapshotDate: snapshotDate,
      });
    }

    // Roll counters up and finalize when nothing is left to do.
    const { data: counts } = await admin
      .from("wh_nightly_units")
      .select("status")
      .eq("run_id", runId);
    const rows = (counts ?? []) as { status: string }[];
    const remaining = rows.filter((r) => r.status === "pending" || r.status === "running").length;
    const done = rows.filter((r) => r.status === "done").length;
    const bad = rows.filter((r) => r.status === "failed" || r.status === "skipped").length;

    const { data: cur } = await admin
      .from("wh_nightly_runs")
      .select("snapshots_written")
      .eq("id", runId)
      .single();

    const finalStatus = remaining > 0 ? "running" : bad === 0 ? "success" : done > 0 ? "partial" : "failed";

    await admin
      .from("wh_nightly_runs")
      .update({
        communities_done: done,
        communities_failed: bad,
        snapshots_written: (cur?.snapshots_written ?? 0) + snapshots,
        status: finalStatus,
        finished_at: remaining > 0 ? null : new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
      })
      .eq("id", runId);

    return { runId, claimed: true, processed, snapshots, failed, remaining, status: finalStatus, details };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nightly run failed";
    await admin
      .from("wh_nightly_runs")
      .update({
        status: "failed",
        error: message.slice(0, 500),
        finished_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
      })
      .eq("id", runId);
    return { runId, claimed: true, processed, snapshots, failed, remaining: 0, status: "failed", details };
  }
}
