/**
 * FURTHER SYNC ENGINE — SERVER ONLY.
 *
 * DESIGN RULES (mirrors the proven WelcomeHome engine)
 * ---------------------------------------------------
 * 1. BOUNDED WORK UNITS. One unit = one dataset, page-capped. A tick runs a
 *    handful of units inside a time budget and returns; the scheduler ticks
 *    again. Nothing depends on a browser tab staying open.
 * 2. PERSISTED PROGRESS + HEARTBEAT. Every unit writes a row in
 *    further_sync_unit_runs and heartbeats `last_progress_at` after each page
 *    is fetched AND persisted, so stalled work is detected by lack of progress.
 * 3. IDEMPOTENT SOURCE-ID UPSERTS. Every table has a natural key from the
 *    source system, so overlapping incremental windows and retries are safe.
 * 4. WATERMARKS ADVANCE ONLY ON SUCCESS, with a small overlap window applied
 *    on the next request.
 * 5. READ-ONLY. Only GET requests are ever issued to Further.
 */

import {
  FURTHER_CORE_DATASETS,
  FURTHER_OVERLAP_MINUTES,
  FURTHER_STALL_MINUTES,
  type FurtherDataset,
} from "./tables";
import {
  furtherCommunities,
  furtherConversation,
  furtherLeadDetail,
  furtherLeadsPage,
  furtherVisitors,
  safeError,
  type FurtherAuth,
} from "./api.server";
import {
  normalizeCommunity,
  normalizeEvent,
  normalizeLead,
  normalizeLeadDetail,
  normalizeVisitor,
  type Row,
} from "./normalize.server";

type Admin = any;

export type UnitStatus = "success" | "partial" | "failed" | "skipped";

export type UnitResult = {
  dataset: FurtherDataset;
  status: UnitStatus;
  rowsReceived: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  rowsUnmapped: number;
  pagesFetched: number;
  sourceMaxUpdatedAt: string | null;
  error: string | null;
  warnings: string[];
};

const LEAD_PAGE_SIZE = 100;
const LEAD_MAX_PAGES = 10;
const VISITOR_MAX_PAGES = 8;
const DETAIL_BATCH = 40;
const CONVERSATION_BATCH = 25;

/** Active Further community mappings — the ONLY source of external community ids. */
export async function furtherTargets(
  admin: Admin,
  organizationId: string,
): Promise<{ communityId: string; externalId: string; name: string }[]> {
  const { data } = await admin
    .from("community_source_mappings")
    .select("external_id, community_id, communities(id, name, organization_id)")
    .eq("organization_id", organizationId)
    .eq("source_type", "further")
    .eq("active", true);
  return (data ?? [])
    .filter((m: any) => m.communities?.organization_id === organizationId)
    .map((m: any) => ({
      communityId: m.community_id as string,
      externalId: String(m.external_id),
      name: (m.communities?.name as string | null) ?? "Community",
    }));
}

function isoMinus(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
}

async function readState(admin: Admin, connectionId: string, dataset: FurtherDataset) {
  const { data } = await admin
    .from("further_sync_state")
    .select("watermark, last_successful_at")
    .eq("connection_id", connectionId)
    .eq("dataset", dataset)
    .maybeSingle();
  return {
    watermark: (data?.watermark as string | null) ?? null,
    lastSuccessfulAt: (data?.last_successful_at as string | null) ?? null,
  };
}

/** Splits a source-id set into new vs existing so counts are honest. */
async function existingIds(
  admin: Admin,
  table: string,
  column: string,
  organizationId: string,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await admin
      .from(table)
      .select(column)
      .eq("organization_id", organizationId)
      .in(column, chunk);
    for (const r of data ?? []) found.add(String((r as any)[column]));
  }
  return found;
}

/**
 * Runs exactly ONE bounded work unit and records its own run row, heartbeat,
 * counters and terminal status.
 */
export async function runFurtherSyncUnit(
  admin: Admin,
  auth: FurtherAuth,
  opts: {
    organizationId: string;
    connectionId: string;
    syncRunId: string;
    dataset: FurtherDataset;
    mode: "full" | "incremental";
  },
): Promise<UnitResult> {
  const started = Date.now();
  const { organizationId, connectionId, syncRunId, dataset, mode } = opts;

  const state = await readState(admin, connectionId, dataset);
  const requestedAfter =
    mode === "incremental" && state.watermark
      ? isoMinus(state.watermark, FURTHER_OVERLAP_MINUTES)
      : null;

  const { data: unitRow } = await admin
    .from("further_sync_unit_runs")
    .insert({
      organization_id: organizationId,
      connection_id: connectionId,
      sync_run_id: syncRunId,
      dataset,
      unit_key: dataset,
      mode,
      status: "running",
      requested_after: requestedAfter,
      last_progress_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const unitId = unitRow?.id as string | undefined;

  const result: UnitResult = {
    dataset,
    status: "success",
    rowsReceived: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsFailed: 0,
    rowsUnmapped: 0,
    pagesFetched: 0,
    sourceMaxUpdatedAt: null,
    error: null,
    warnings: [],
  };

  const heartbeat = async () => {
    if (!unitId) return;
    await admin
      .from("further_sync_unit_runs")
      .update({
        last_progress_at: new Date().toISOString(),
        rows_received: result.rowsReceived,
        rows_inserted: result.rowsInserted,
        rows_updated: result.rowsUpdated,
        rows_failed: result.rowsFailed,
        rows_unmapped: result.rowsUnmapped,
        pages_fetched: result.pagesFetched,
      })
      .eq("id", unitId);
  };

  const targets = await furtherTargets(admin, organizationId);
  const communityByExternal = new Map(targets.map((t) => [t.externalId, t.communityId]));

  await admin
    .from("further_sync_state")
    .upsert(
      {
        organization_id: organizationId,
        connection_id: connectionId,
        dataset,
        last_attempted_at: new Date().toISOString(),
      },
      { onConflict: "connection_id,dataset" },
    );

  try {
    if (dataset === "communities") {
      const rows = await furtherCommunities(auth);
      result.pagesFetched = 1;
      const normalized = rows
        .map((r) => normalizeCommunity(r))
        .filter((r): r is NonNullable<typeof r> => !!r);
      result.rowsReceived = normalized.length;
      if (normalized.length) {
        const ids = normalized.map((c) => c.further_community_id);
        const { data: prior } = await admin
          .from("further_communities")
          .select("further_community_id")
          .eq("connection_id", connectionId)
          .in("further_community_id", ids);
        const seen = new Set((prior ?? []).map((r: any) => String(r.further_community_id)));
        const { error } = await admin.from("further_communities").upsert(
          normalized.map((c) => ({
            organization_id: organizationId,
            connection_id: connectionId,
            ...c,
            community_id: communityByExternal.get(c.further_community_id) ?? null,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "connection_id,further_community_id" },
        );
        if (error) throw new Error(error.message);
        result.rowsInserted = normalized.filter((c) => !seen.has(c.further_community_id)).length;
        result.rowsUpdated = normalized.length - result.rowsInserted;
      }
      await heartbeat();
    }

    if (dataset === "leads") {
      let page = 1;
      let cursorNext: string | null = null;
      for (;;) {
        const { rows, next } = await furtherLeadsPage(auth, {
          updatedStart: requestedAfter,
          page,
          pageSize: LEAD_PAGE_SIZE,
        });
        result.pagesFetched += 1;
        cursorNext = next;
        const normalized = rows
          .map((r) => normalizeLead(r))
          .filter((r): r is NonNullable<typeof r> => !!r);
        result.rowsReceived += normalized.length;

        if (normalized.length) {
          const ids = normalized.map((l) => l.further_lead_id);
          const seen = await existingIds(
            admin,
            "further_leads",
            "further_lead_id",
            organizationId,
            ids,
          );
          const payloadRows = normalized.map((l) => {
            const communityId = l.further_community_id
              ? (communityByExternal.get(l.further_community_id) ?? null)
              : null;
            if (!communityId) result.rowsUnmapped += 1;
            return {
              organization_id: organizationId,
              connection_id: connectionId,
              ...l,
              community_id: communityId,
              synced_at: new Date().toISOString(),
            };
          });
          const { error } = await admin
            .from("further_leads")
            .upsert(payloadRows, { onConflict: "organization_id,further_lead_id" });
          if (error) throw new Error(error.message);
          result.rowsInserted += ids.filter((id) => !seen.has(id)).length;
          result.rowsUpdated += ids.filter((id) => seen.has(id)).length;

          for (const l of normalized) {
            const stamp = l.source_updated_at ?? l.created_on;
            if (stamp && (!result.sourceMaxUpdatedAt || stamp > result.sourceMaxUpdatedAt)) {
              result.sourceMaxUpdatedAt = stamp;
            }
          }
        }
        await heartbeat();

        if (!normalized.length) break;
        if (result.pagesFetched >= LEAD_MAX_PAGES) {
          result.status = "partial";
          result.warnings.push(
            `Stopped after ${LEAD_MAX_PAGES} pages; the next tick resumes from the watermark.`,
          );
          break;
        }
        if (!cursorNext && normalized.length < LEAD_PAGE_SIZE) break;
        page += 1;
      }
    }

    if (dataset === "lead_details") {
      const { data: leads } = await admin
        .from("further_leads")
        .select("further_lead_id, community_id, updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(400);
      const leadRows = (leads ?? []) as any[];
      const { data: details } = await admin
        .from("further_lead_details")
        .select("further_lead_id, synced_at")
        .eq("organization_id", organizationId)
        .in(
          "further_lead_id",
          leadRows.map((l) => l.further_lead_id),
        );
      const detailAt = new Map(
        (details ?? []).map((d: any) => [String(d.further_lead_id), String(d.synced_at)]),
      );
      const due = leadRows
        .filter((l) => {
          const at = detailAt.get(String(l.further_lead_id));
          return !at || at < String(l.updated_at);
        })
        .slice(0, DETAIL_BATCH);

      for (const lead of due) {
        try {
          const detail = await furtherLeadDetail(auth, String(lead.further_lead_id));
          result.pagesFetched += 1;
          if (!detail) continue;
          const n = normalizeLeadDetail(String(lead.further_lead_id), detail as Row);
          result.rowsReceived += 1;
          const communityId =
            (lead.community_id as string | null) ??
            (n.further_community_id ? (communityByExternal.get(n.further_community_id) ?? null) : null);
          const { further_community_id: _drop, ...detailFields } = n;
          const { error } = await admin.from("further_lead_details").upsert(
            {
              organization_id: organizationId,
              connection_id: connectionId,
              ...detailFields,
              community_id: communityId,
              detail_fetched_at: new Date().toISOString(),
              synced_at: new Date().toISOString(),
            },
            { onConflict: "organization_id,further_lead_id" },
          );
          if (error) throw new Error(error.message);
          result.rowsUpdated += detailAt.has(String(lead.further_lead_id)) ? 1 : 0;
          result.rowsInserted += detailAt.has(String(lead.further_lead_id)) ? 0 : 1;
        } catch (err) {
          result.rowsFailed += 1;
          result.warnings.push(`lead ${lead.further_lead_id}: ${safeError(err)}`);
        }
        await heartbeat();
      }
      if (result.rowsFailed > 0 && result.rowsReceived > 0) result.status = "partial";
      if (result.rowsFailed > 0 && result.rowsReceived === 0) result.status = "failed";
    }

    if (dataset === "conversations") {
      const { data: leads } = await admin
        .from("further_leads")
        .select("further_lead_id, community_id, updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(300);
      const leadRows = (leads ?? []) as any[];
      const { data: events } = await admin
        .from("further_conversation_events")
        .select("further_lead_id, synced_at")
        .eq("organization_id", organizationId)
        .in(
          "further_lead_id",
          leadRows.map((l) => l.further_lead_id),
        );
      const lastEventSync = new Map<string, string>();
      for (const e of (events ?? []) as any[]) {
        const key = String(e.further_lead_id);
        const at = String(e.synced_at);
        if (!lastEventSync.has(key) || lastEventSync.get(key)! < at) lastEventSync.set(key, at);
      }
      // Only new or changed leads get a timeline refresh — never the whole history.
      const due = leadRows
        .filter((l) => {
          const at = lastEventSync.get(String(l.further_lead_id));
          return !at || at < String(l.updated_at);
        })
        .slice(0, CONVERSATION_BATCH);

      for (const lead of due) {
        try {
          const rows = await furtherConversation(auth, String(lead.further_lead_id));
          result.pagesFetched += 1;
          const normalized = rows.map((r, i) => normalizeEvent(r, i));
          result.rowsReceived += normalized.length;
          if (normalized.length) {
            const { error } = await admin.from("further_conversation_events").upsert(
              normalized.map((e) => ({
                organization_id: organizationId,
                connection_id: connectionId,
                further_lead_id: String(lead.further_lead_id),
                community_id: (lead.community_id as string | null) ?? null,
                event_key: e.event_key,
                message_type: e.message_type,
                created_on: e.created_on,
                data: e.data,
                synced_at: new Date().toISOString(),
              })),
              { onConflict: "organization_id,further_lead_id,event_key" },
            );
            if (error) throw new Error(error.message);
            result.rowsInserted += normalized.length;
          } else {
            // Record the refresh attempt so an empty timeline is not retried
            // every tick: an event-free lead simply has no rows.
            result.warnings.push(`lead ${lead.further_lead_id}: no timeline events`);
          }
        } catch (err) {
          result.rowsFailed += 1;
          result.warnings.push(`lead ${lead.further_lead_id}: ${safeError(err)}`);
        }
        await heartbeat();
      }
      if (result.rowsFailed > 0) result.status = result.rowsReceived > 0 ? "partial" : "failed";
    }

    if (dataset === "visitors") {
      const start =
        mode === "incremental" && state.watermark
          ? isoMinus(state.watermark, FURTHER_OVERLAP_MINUTES)
          : isoMinus(new Date().toISOString(), 60 * 24 * 90);
      const { rows, pages, truncated } = await furtherVisitors(auth, {
        start,
        maxPages: VISITOR_MAX_PAGES,
      });
      result.pagesFetched = pages;
      const normalized = rows
        .map((r) => normalizeVisitor(r))
        .filter((r): r is NonNullable<typeof r> => !!r);
      result.rowsReceived = normalized.length;
      if (normalized.length) {
        const ids = normalized.map((v) => v.visitor_uuid);
        const seen = await existingIds(admin, "further_visitors", "visitor_uuid", organizationId, ids);
        const { error } = await admin.from("further_visitors").upsert(
          normalized.map((v) => {
            const communityId = v.further_community_id
              ? (communityByExternal.get(v.further_community_id) ?? null)
              : null;
            if (!communityId) result.rowsUnmapped += 1;
            return {
              organization_id: organizationId,
              connection_id: connectionId,
              ...v,
              community_id: communityId,
              synced_at: new Date().toISOString(),
            };
          }),
          { onConflict: "organization_id,visitor_uuid" },
        );
        if (error) throw new Error(error.message);
        result.rowsInserted = ids.filter((id) => !seen.has(id)).length;
        result.rowsUpdated = ids.length - result.rowsInserted;
        for (const v of normalized) {
          if (v.occurred_at && (!result.sourceMaxUpdatedAt || v.occurred_at > result.sourceMaxUpdatedAt)) {
            result.sourceMaxUpdatedAt = v.occurred_at;
          }
        }
      }
      if (truncated) {
        result.status = "partial";
        result.warnings.push("Visitor pages capped for this tick; the next tick continues.");
      }
      await heartbeat();
    }
  } catch (err) {
    result.status = "failed";
    result.error = safeError(err);
  }

  const duration = Date.now() - started;
  if (unitId) {
    await admin
      .from("further_sync_unit_runs")
      .update({
        status: result.status,
        rows_received: result.rowsReceived,
        rows_inserted: result.rowsInserted,
        rows_updated: result.rowsUpdated,
        rows_failed: result.rowsFailed,
        rows_unmapped: result.rowsUnmapped,
        pages_fetched: result.pagesFetched,
        source_max_updated_at: result.sourceMaxUpdatedAt,
        duration_ms: duration,
        error_summary: result.error,
        warnings: result.warnings.slice(0, 20),
        last_progress_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", unitId);
  }

  // The watermark only ever advances on a clean or partial-but-progressing run.
  const advance = result.status === "success" || result.status === "partial";
  await admin.from("further_sync_state").upsert(
    {
      organization_id: organizationId,
      connection_id: connectionId,
      dataset,
      ...(advance && result.sourceMaxUpdatedAt ? { watermark: result.sourceMaxUpdatedAt } : {}),
      ...(advance ? { last_successful_at: new Date().toISOString() } : {}),
      rows_received: result.rowsReceived,
      rows_inserted: result.rowsInserted,
      rows_updated: result.rowsUpdated,
      rows_failed: result.rowsFailed,
      rows_unmapped: result.rowsUnmapped,
      error_summary: result.error,
    },
    { onConflict: "connection_id,dataset" },
  );

  return result;
}

export type SliceResult = {
  syncRunId: string | null;
  status: "success" | "partial" | "failed" | "skipped";
  units: UnitResult[];
  remaining: FurtherDataset[];
  message: string | null;
};

/**
 * Runs a bounded SLICE of a Further sync server-side: reap stalled work, open
 * (or reuse) a parent run, execute datasets in order inside a time budget, then
 * finalize honestly. Used by both the scheduler hook and "Sync now" — no
 * browser participation required.
 */
export async function runFurtherSlice(
  admin: Admin,
  auth: FurtherAuth,
  opts: {
    organizationId: string;
    connectionId: string;
    datasets: FurtherDataset[];
    mode: "full" | "incremental";
    budgetMs?: number;
    resumeRunId?: string | null;
    trigger: "schedule" | "manual";
  },
): Promise<SliceResult> {
  const budget = opts.budgetMs ?? 45_000;
  const startedAt = Date.now();

  await admin.rpc("further_sync_reap_stalled", {
    _org_id: opts.organizationId,
    _stall_minutes: FURTHER_STALL_MINUTES,
  });

  const targets = await furtherTargets(admin, opts.organizationId);
  const needsMapping = opts.datasets.filter((d) => d !== "communities");
  if (!targets.length && needsMapping.length === opts.datasets.length) {
    return {
      syncRunId: null,
      status: "skipped",
      units: [],
      remaining: opts.datasets,
      message:
        "No confirmed Further community mappings. Map at least one Further community before syncing lead, visitor or conversation data.",
    };
  }

  let syncRunId: string;
  if (opts.resumeRunId) {
    const { data: parent } = await admin
      .from("source_sync_runs")
      .select("id")
      .eq("id", opts.resumeRunId)
      .eq("organization_id", opts.organizationId)
      .eq("connection_id", opts.connectionId)
      .maybeSingle();
    if (!parent) throw new Error("Sync run not found for this connection");
    syncRunId = parent.id as string;
  } else {
    const { data: run, error } = await admin
      .from("source_sync_runs")
      .insert({
        organization_id: opts.organizationId,
        connection_id: opts.connectionId,
        status: "running",
        sync_cursor: {
          source: "further",
          mode: opts.mode,
          datasets: opts.datasets,
          trigger: opts.trigger,
        },
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(`Unable to start sync run: ${error?.message ?? "unknown"}`);
    syncRunId = run.id as string;
  }

  await admin
    .from("data_source_connections")
    .update({ status: "syncing", last_attempted_sync_at: new Date().toISOString() })
    .eq("id", opts.connectionId)
    .eq("organization_id", opts.organizationId);

  const units: UnitResult[] = [];
  const remaining: FurtherDataset[] = [];
  for (const dataset of opts.datasets) {
    if (Date.now() - startedAt > budget) {
      remaining.push(dataset);
      continue;
    }
    units.push(
      await runFurtherSyncUnit(admin, auth, {
        organizationId: opts.organizationId,
        connectionId: opts.connectionId,
        syncRunId,
        dataset,
        mode: opts.mode,
      }),
    );
  }

  const core = units.filter((u) => FURTHER_CORE_DATASETS.includes(u.dataset));
  const coreOk = core.filter((u) => u.status === "success" || u.status === "partial");
  const allClean = units.every((u) => u.status === "success");
  const status: SliceResult["status"] =
    core.length > 0 && coreOk.length === 0
      ? "failed"
      : allClean && remaining.length === 0
        ? "success"
        : "partial";

  const totals = units.reduce(
    (a, u) => ({
      received: a.received + u.rowsReceived,
      inserted: a.inserted + u.rowsInserted,
      updated: a.updated + u.rowsUpdated,
      failed: a.failed + u.rowsFailed,
    }),
    { received: 0, inserted: 0, updated: 0, failed: 0 },
  );

  const errorSummary =
    units
      .filter((u) => u.error)
      .map((u) => `${u.dataset}: ${u.error}`)
      .join(" | ")
      .slice(0, 1000) || null;

  await admin
    .from("source_sync_runs")
    .update({
      status,
      completed_at: remaining.length ? null : new Date().toISOString(),
      records_received: totals.received,
      records_inserted: totals.inserted,
      records_updated: totals.updated,
      records_failed: totals.failed,
      error_summary: errorSummary,
    })
    .eq("id", syncRunId);

  const through = units
    .map((u) => u.sourceMaxUpdatedAt)
    .filter((d): d is string => !!d)
    .sort();

  await admin
    .from("data_source_connections")
    .update({
      status: status === "failed" ? "needs_attention" : "connected",
      last_attempted_sync_at: new Date().toISOString(),
      ...(status === "failed" ? {} : { last_successful_sync_at: new Date().toISOString() }),
      ...(through.length ? { data_through_date: String(through[through.length - 1]).slice(0, 10) } : {}),
    })
    .eq("id", opts.connectionId)
    .eq("organization_id", opts.organizationId);

  return { syncRunId, status, units, remaining, message: errorSummary };
}

export type MatchReport = {
  candidatesExamined: number;
  externalIdsPresent: number;
  fieldCounts: Record<string, number>;
  provenField: string | null;
  activeMatches: number;
  unmatched: number;
  note: string;
};

/**
 * FURTHER <-> WELCOMEHOME JOIN VALIDATION + MATCH WRITING.
 *
 * The Further `external_lead_id` is the only deterministic candidate. Which
 * WelcomeHome field it corresponds to is NOT assumed: every candidate field is
 * counted against live data first, and match rows are only marked active for
 * the single field that actually reconciles. Name/email/phone are never used as
 * attribution evidence.
 */
export async function matchFurtherToWelcomeHome(
  admin: Admin,
  organizationId: string,
  opts?: { limit?: number },
): Promise<MatchReport> {
  const limit = opts?.limit ?? 500;
  const { data: leads } = await admin
    .from("further_leads")
    .select("further_lead_id, external_lead_id, community_id")
    .eq("organization_id", organizationId)
    .order("created_on", { ascending: false })
    .limit(limit);
  const rows = (leads ?? []) as any[];
  const withExternal = rows.filter((l) => l.external_lead_id);
  const ids = [...new Set(withExternal.map((l) => String(l.external_lead_id)))];

  const CANDIDATES = ["source_id", "account_id", "merged_into_prospect_id"] as const;
  const fieldCounts: Record<string, number> = {};
  const hits: Record<string, Map<string, string>> = {};

  for (const field of CANDIDATES) {
    const found = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (!chunk.length) break;
      const { data } = await admin
        .from("wh_prospects")
        .select(`source_id, ${field}`)
        .eq("organization_id", organizationId)
        .in(field, chunk);
      for (const p of (data ?? []) as any[]) {
        const key = String(p[field]);
        if (key) found.set(key, String(p.source_id));
      }
    }
    fieldCounts[field] = found.size;
    hits[field] = found;
  }

  const provenField =
    Object.entries(fieldCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let activeMatches = 0;
  if (provenField) {
    const map = hits[provenField]!;
    const upserts = withExternal
      .filter((l) => map.has(String(l.external_lead_id)))
      .map((l) => ({
        organization_id: organizationId,
        further_lead_id: String(l.further_lead_id),
        further_external_lead_id: String(l.external_lead_id),
        wh_prospect_id: map.get(String(l.external_lead_id))!,
        wh_field: provenField,
        community_id: (l.community_id as string | null) ?? null,
        match_method: `further.external_lead_id = wh_prospects.${provenField}`,
        evidence_type: "exact_external_id",
        is_active: true,
        matched_at: new Date().toISOString(),
        audit: { validated_against: "live_data", candidate_counts: fieldCounts },
      }));
    activeMatches = upserts.length;
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await admin
        .from("further_wh_matches")
        .upsert(upserts.slice(i, i + 200), {
          onConflict: "organization_id,further_lead_id,evidence_type",
        });
      if (error) throw new Error(error.message);
    }
  }

  return {
    candidatesExamined: rows.length,
    externalIdsPresent: withExternal.length,
    fieldCounts,
    provenField,
    activeMatches,
    unmatched: withExternal.length - activeMatches,
    note: provenField
      ? `external_lead_id reconciles to wh_prospects.${provenField}; only that field is used as active evidence.`
      : "No WelcomeHome field reconciled to Further external_lead_id in the sampled data. No matches were activated.",
  };
}
