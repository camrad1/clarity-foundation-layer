/**
 * SCHEDULED CRM DATASET REFRESH (prospects, activities, touchpoints, deposits).
 *
 * The nightly worker only refreshes the current-state datasets a daily
 * occupancy snapshot needs (Units, HousingContracts). The sales datasets were
 * only ever loaded by operator-triggered syncs, so they silently went stale.
 *
 * DESIGN RULES
 * ------------
 * 1. BOUNDED WORK. A tick runs at most `maxUnits` existing bounded sync work
 *    units (`runWelcomeHomeSyncUnit`), each already page-capped with a resume
 *    cursor. Request duration never scales with portfolio size.
 * 2. STALEST FIRST. Each tick picks the (table x community) pairs whose last
 *    successful sync is oldest, so the rotation self-heals after any outage.
 * 3. NO NEW INGESTION LOGIC. Normalization, mapping, watermarks and metric
 *    definitions are untouched; this module only decides what to refresh next.
 */

import type { WhTable } from "./tables";

type Admin = any;

/** Fact datasets that carry sales activity and must stay current. */
export const CRM_REFRESH_TABLES: WhTable[] = [
  "Prospects",
  "Activities",
  "MarketingTouchpoints",
  "DepositTransactions",
] as WhTable[];

export type CrmTickResult = {
  organizationId: string;
  processed: number;
  failed: number;
  details: { table: string; community: string; status: string; rows?: number; error?: string }[];
  skipped?: string;
};

export async function tickCrmRefresh(
  admin: Admin,
  args: { organizationId: string; connectionId: string; maxUnits?: number },
): Promise<CrmTickResult> {
  const maxUnits = Math.max(1, Math.min(args.maxUnits ?? 2, 4));
  const details: CrmTickResult["details"] = [];

  const { data: cred } = await admin
    .from("data_source_credentials")
    .select("secret_value")
    .eq("connection_id", args.connectionId)
    .maybeSingle();
  const apiToken = cred?.secret_value as string | undefined;
  if (!apiToken) {
    return {
      organizationId: args.organizationId,
      processed: 0,
      failed: 0,
      details,
      skipped: "no_credential",
    };
  }

  const { nightlyTargets } = await import("./nightly.server");
  const targets = await nightlyTargets(admin, args.organizationId);
  if (!targets.length) {
    return {
      organizationId: args.organizationId,
      processed: 0,
      failed: 0,
      details,
      skipped: "no_mapped_communities",
    };
  }

  const { data: stateRows } = await admin
    .from("wh_sync_state")
    .select("source_table, community_scope, last_successful_at")
    .eq("connection_id", args.connectionId)
    .in("source_table", CRM_REFRESH_TABLES as string[]);
  const lastSuccess = new Map<string, string | null>();
  for (const r of (stateRows ?? []) as any[]) {
    lastSuccess.set(`${r.source_table}:${r.community_scope}`, r.last_successful_at ?? null);
  }

  // Every (dataset x community) pair, oldest successful refresh first. Pairs
  // that never synced sort ahead of everything else.
  const candidates = targets
    .flatMap((t) =>
      CRM_REFRESH_TABLES.map((table) => ({
        table,
        target: t,
        last: lastSuccess.get(`${table}:${t.communityId}`) ?? null,
      })),
    )
    .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? ""))
    .slice(0, maxUnits);

  const { data: settings } = await admin
    .from("wh_settings")
    .select("incremental_overlap_minutes")
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  const { data: syncRun } = await admin
    .from("source_sync_runs")
    .insert({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      status: "running",
      sync_cursor: {
        mode: "full",
        scheduled: "crm_refresh",
        tables: candidates.map((c) => c.table),
      },
    })
    .select("id")
    .single();

  const { runWelcomeHomeSyncUnit } = await import("./sync.server");
  let processed = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const res = await runWelcomeHomeSyncUnit(
        admin,
        { token: apiToken },
        {
          organizationId: args.organizationId,
          connectionId: args.connectionId,
          syncRunId: syncRun.id,
          table: c.table,
          target: {
            communityId: c.target.communityId,
            sourceCommunityId: c.target.sourceCommunityId,
            timezone: c.target.timezone,
          },
          mode: "full",
          overlapMinutes: settings?.incremental_overlap_minutes ?? 120,
        },
      );
      processed += 1;
      if (res.status !== "success") failed += 1;
      details.push({
        table: c.table,
        community: c.target.name,
        status: res.status,
        rows: res.rowsReceived,
        ...(res.error ? { error: res.error } : {}),
      });
    } catch (err) {
      processed += 1;
      failed += 1;
      details.push({
        table: c.table,
        community: c.target.name,
        status: "failed",
        error: err instanceof Error ? err.message : "sync unit failed",
      });
    }
  }

  await admin
    .from("source_sync_runs")
    .update({
      status: failed === 0 ? "success" : processed > failed ? "partial" : "failed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", syncRun.id);

  if (failed === 0 && processed > 0) {
    await admin
      .from("data_source_connections")
      .update({
        last_attempted_sync_at: new Date().toISOString(),
        last_successful_sync_at: new Date().toISOString(),
      })
      .eq("id", args.connectionId);
  } else if (processed > 0) {
    await admin
      .from("data_source_connections")
      .update({ last_attempted_sync_at: new Date().toISOString() })
      .eq("id", args.connectionId);
  }

  return { organizationId: args.organizationId, processed, failed, details };
}
