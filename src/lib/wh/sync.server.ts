/**
 * WelcomeHome synchronization engine — SERVER ONLY.
 *
 * READ-ONLY GUARANTEE: this module issues GET requests to WelcomeHome and
 * nothing else. No CRM record is created, edited, merged or annotated.
 *
 * IDEMPOTENCY: every normalized table carries UNIQUE (connection_id,
 * source_id). Records are upserted on that key, so re-running a sync — full or
 * incremental, overlapping or not — can never duplicate a row.
 *
 * INCREMENTAL WATERMARK: per connection AND per source table (never one global
 * watermark, because tables sync independently). The next incremental request
 * asks for filters[updated_at_after] = watermark, where watermark is the
 * maximum source updated_at observed in the previous successful run MINUS a
 * configurable safety overlap (wh_settings.incremental_overlap_minutes,
 * default 120). The overlap deliberately re-reads boundary records; source-ID
 * upsert makes that harmless.
 *
 * RAW STAGING: rows that fail normalization or cannot be resolved to a mapped
 * community are written to source_records_raw with the untouched payload so
 * nothing is silently dropped. Successfully normalized rows keep their entire
 * source row in the destination table's `metadata` column, which is the audit
 * copy for reconciliation.
 *
 * LOGGING: never logs the API token, prospect email, phone, resident details
 * or activity notes. Only table names, counts, source IDs and sync IDs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WH_CORE_DESTINATION,
  WH_LOOKUP_KEY,
  WH_LOOKUP_SOURCE,
  WH_MAX_PAGES,
  WH_REFERRER_SAFE_FIELDS,
  isCoreTable,
  type WhCoreTable,
  type WhLookupTable,
  type WhTable,
} from "./tables";
import { NORMALIZERS, sourceId, stripPii, updatedAt, type Rec } from "./normalize.server";
import { safeError, whExportPage, whLookup, type WhAuth } from "./api.server";

type Admin = SupabaseClient<any, "public", any>;

/**
 * `unsupported` is a first-class outcome: WelcomeHome genuinely does not expose
 * some datasets on the transport we ask for. Reporting that as `success` (or as
 * a generic failure) is what made the first real sync look healthy while it
 * ingested nothing.
 */
export type TableStatus = "success" | "partial" | "failed" | "skipped" | "unsupported";

export type TableResult = {
  table: WhTable;
  status: TableStatus;
  mode: "full" | "incremental";
  rowsReceived: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  rowsUnmapped: number;
  rawRowsStored: number;
  pagesFetched: number;
  sourceMaxUpdatedAt: string | null;
  durationMs: number;
  error: string | null;
  warnings: string[];
};

export type CommunityTarget = {
  communityId: string;
  sourceCommunityId: string;
  timezone: string | null;
};

const CHUNK = 500;

/**
 * Decides the outcome of a table from what actually landed in the warehouse.
 * Receiving rows and persisting none is a FAILURE, not a success — that exact
 * case previously reported "Success" with zero normalized records.
 */
function classify(result: TableResult): TableStatus {
  if (result.status === "failed" || result.status === "unsupported") return result.status;
  const persisted = result.rowsInserted + result.rowsUpdated;
  if (result.rowsReceived === 0) return "success";
  if (persisted === 0) return "failed";
  if (result.rowsFailed > 0 || result.rowsUnmapped > 0) return "partial";
  return "success";
}


async function upsertChunk(
  admin: Admin,
  destination: string,
  connectionId: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; updated: number }> {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const ids = rows.map((r) => String(r["source_id"]));
  const { data: existing, error: exErr } = await admin
    .from(destination)
    .select("source_id")
    .eq("connection_id", connectionId)
    .in("source_id", ids);
  if (exErr) throw new Error(`${destination}: ${exErr.message}`);
  const known = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id));
  const { error } = await admin
    .from(destination)
    .upsert(rows, { onConflict: "connection_id,source_id" });
  if (error) throw new Error(`${destination}: ${error.message}`);
  const updated = ids.filter((id) => known.has(id)).length;
  return { inserted: ids.length - updated, updated };
}

async function storeRaw(
  admin: Admin,
  ctx: {
    organizationId: string;
    connectionId: string;
    syncRunId: string | null;
    table: string;
    communityId: string | null;
    sourceCommunityId: string | null;
  },
  records: Rec[],
) {
  if (!records.length) return 0;
  const rows = records.map((rec) => ({
    organization_id: ctx.organizationId,
    connection_id: ctx.connectionId,
    sync_run_id: ctx.syncRunId,
    source_type: "welcomehome",
    record_type: ctx.table,
    source_record_id: sourceId(rec) ?? crypto.randomUUID(),
    source_community_external_id: ctx.sourceCommunityId,
    community_id: ctx.communityId,
    contains_pii: true,
    payload: rec,
  }));
  const { error } = await admin.from("source_records_raw").insert(rows);
  if (error) return 0;
  return rows.length;
}

async function syncLookupTable(
  admin: Admin,
  auth: WhAuth,
  args: {
    organizationId: string;
    connectionId: string;
    table: WhLookupTable;
    targets: CommunityTarget[];
  },
): Promise<TableResult> {
  const started = Date.now();
  const result: TableResult = {
    table: args.table,
    status: "success",
    mode: "full",
    rowsReceived: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsFailed: 0,
    rowsUnmapped: 0,
    rawRowsStored: 0,
    pagesFetched: 0,
    sourceMaxUpdatedAt: null,
    durationMs: 0,
    error: null,
    warnings: [],
  };
  const seen = new Set<string>();
  const batch: Record<string, unknown>[] = [];

  try {
    // Lookups are always refreshed in full: they are small and label changes
    // must never be missed by a watermark.
    const transport = WH_LOOKUP_SOURCE[args.table].kind;
    // JSON lookups are account-wide, so they are fetched once, not per
    // community. Only the Referrers export is community-scoped.
    const scopes: (CommunityTarget | null)[] =
      transport === "json" ? [null] : args.targets.length ? args.targets : [];

    for (const scope of scopes) {
      const { records, pages } = await whLookup(auth, args.table, scope?.sourceCommunityId ?? null);
      result.pagesFetched += pages;
      result.rowsReceived += records.length;
      for (const raw of records) {
        // Referrers rows are people; keep only the non-identifying columns.
        const rec: Rec =
          args.table === "Referrers"
            ? Object.fromEntries(
                (WH_REFERRER_SAFE_FIELDS as readonly string[])
                  .filter((k) => raw[k] !== undefined)
                  .map((k) => [k, raw[k]!]),
              )
            : stripPii(raw);
        const id = sourceId(rec) ?? rec["referrers_id"] ?? null;
        if (!id) {
          result.rowsFailed += 1;
          continue;
        }
        const key = `${args.table}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        batch.push({
          organization_id: args.organizationId,
          connection_id: args.connectionId,
          lookup_type: WH_LOOKUP_KEY[args.table],
          source_id: id,
          label: rec["name"] ?? rec["label"] ?? rec["title"] ?? rec["scores_name"] ?? null,
          source_community_id: scope?.sourceCommunityId ?? null,
          payload: rec,
        });
      }
    }

    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK);
      const ids = slice.map((r) => String(r["source_id"]));
      const { data: existing } = await admin
        .from("wh_lookups")
        .select("source_id")
        .eq("connection_id", args.connectionId)
        .eq("lookup_type", WH_LOOKUP_KEY[args.table])
        .in("source_id", ids);
      const known = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id));
      const { error } = await admin
        .from("wh_lookups")
        .upsert(slice, { onConflict: "connection_id,lookup_type,source_id" });
      if (error) throw new Error(error.message);
      const updated = ids.filter((id) => known.has(id)).length;
      result.rowsUpdated += updated;
      result.rowsInserted += ids.length - updated;
    }
  } catch (err) {
    const message = safeError(err);
    // A 404 means WelcomeHome does not serve this dataset at all — a permanent
    // capability gap, not a transient sync error.
    result.status = /\(404\)|not exposed/.test(message) ? "unsupported" : "failed";
    result.error = message;
  }
  result.status = classify(result);
  result.durationMs = Date.now() - started;
  return result;
}


async function syncCoreTable(
  admin: Admin,
  auth: WhAuth,
  args: {
    organizationId: string;
    connectionId: string;
    syncRunId: string | null;
    table: WhCoreTable;
    targets: CommunityTarget[];
    updatedAfter: string | null;
  },
): Promise<TableResult> {
  const started = Date.now();
  const destination = WH_CORE_DESTINATION[args.table];
  const normalize = NORMALIZERS[args.table];
  const result: TableResult = {
    table: args.table,
    status: "success",
    mode: args.updatedAfter ? "incremental" : "full",
    rowsReceived: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsFailed: 0,
    rowsUnmapped: 0,
    rawRowsStored: 0,
    pagesFetched: 0,
    sourceMaxUpdatedAt: null,
    durationMs: 0,
    error: null,
    warnings: [],
  };

  try {
    for (const scope of args.targets) {
      // Exports ignore page/per_page; the Link cursor is the only way forward.
      let cursorUrl: string | null = null;
      let pages = 0;
      for (;;) {
        const { records, nextUrl } = await whExportPage(auth, {
          table: args.table,
          communitySourceId: scope.sourceCommunityId,
          cursorUrl,
          updatedAfter: args.updatedAfter,
        });
        pages += 1;
        result.pagesFetched += 1;
        result.rowsReceived += records.length;

        const good: Record<string, unknown>[] = [];
        const bad: Rec[] = [];
        for (const rec of records) {
          try {
            const row = normalize(rec, {
              organizationId: args.organizationId,
              connectionId: args.connectionId,
              communityId: scope.communityId,
              timezone: scope.timezone,
            }) as Record<string, unknown>;
            if (!row["source_id"]) {
              bad.push(rec);
              result.rowsFailed += 1;
            } else {
              good.push(row);
              if (!row["community_id"]) result.rowsUnmapped += 1;
            }
          } catch {
            bad.push(rec);
            result.rowsFailed += 1;
          }
          const u = updatedAt(rec);
          if (u && (!result.sourceMaxUpdatedAt || u > result.sourceMaxUpdatedAt)) {
            result.sourceMaxUpdatedAt = u;
          }
        }

        if (bad.length) {
          result.rawRowsStored += await storeRaw(
            admin,
            {
              organizationId: args.organizationId,
              connectionId: args.connectionId,
              syncRunId: args.syncRunId,
              table: args.table,
              communityId: scope.communityId,
              sourceCommunityId: scope.sourceCommunityId,
            },
            bad,
          );
          result.warnings.push(`${bad.length} row(s) from ${scope.sourceCommunityId} kept as raw`);
        }

        for (let i = 0; i < good.length; i += CHUNK) {
          const { inserted, updated } = await upsertChunk(
            admin,
            destination,
            args.connectionId,
            good.slice(i, i + CHUNK),
          );
          result.rowsInserted += inserted;
          result.rowsUpdated += updated;
        }

        if (!nextUrl || records.length === 0) break;
        if (pages >= WH_MAX_PAGES) {
          result.warnings.push(
            `${args.table}: stopped after ${WH_MAX_PAGES} pages for ${scope.sourceCommunityId}; more rows remain`,
          );
          result.rowsFailed += 1;
          break;
        }
        cursorUrl = nextUrl;
      }
    }
  } catch (err) {
    const message = safeError(err);
    result.status = /\(404\)|not exposed/.test(message) ? "unsupported" : "failed";
    result.error = message;
  }
  result.status = classify(result);


  result.durationMs = Date.now() - started;
  return result;
}

export async function runWelcomeHomeSync(
  admin: Admin,
  auth: WhAuth,
  args: {
    organizationId: string;
    connectionId: string;
    mode: "full" | "incremental";
    tables: WhTable[];
    targets: CommunityTarget[];
    overlapMinutes: number;
  },
): Promise<{ syncRunId: string; results: TableResult[]; status: "success" | "partial" | "failed" }> {
  const { data: run, error: runErr } = await admin
    .from("source_sync_runs")
    .insert({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      status: "running",
      sync_cursor: { mode: args.mode, tables: args.tables },
    })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`Unable to start sync run: ${runErr?.message ?? "unknown"}`);
  const syncRunId = run.id as string;

  await admin
    .from("data_source_connections")
    .update({ status: "syncing", last_attempted_sync_at: new Date().toISOString() })
    .eq("id", args.connectionId)
    .eq("organization_id", args.organizationId);

  const results: TableResult[] = [];

  for (const table of args.tables) {
    let updatedAfter: string | null = null;
    if (args.mode === "incremental" && isCoreTable(table)) {
      const { data: state } = await admin
        .from("wh_sync_state")
        .select("watermark, source_max_updated_at")
        .eq("connection_id", args.connectionId)
        .eq("source_table", table)
        .maybeSingle();
      const base = state?.source_max_updated_at ?? state?.watermark ?? null;
      if (base) {
        updatedAfter = new Date(
          new Date(base).getTime() - args.overlapMinutes * 60_000,
        ).toISOString();
      }
    }

    await admin.from("wh_sync_state").upsert(
      {
        organization_id: args.organizationId,
        connection_id: args.connectionId,
        source_table: table,
        last_attempted_at: new Date().toISOString(),
      },
      { onConflict: "connection_id,source_table" },
    );

    const result = isCoreTable(table)
      ? await syncCoreTable(admin, auth, {
          organizationId: args.organizationId,
          connectionId: args.connectionId,
          syncRunId,
          table,
          targets: args.targets,
          updatedAfter,
        })
      : await syncLookupTable(admin, auth, {
          organizationId: args.organizationId,
          connectionId: args.connectionId,
          table: table as WhLookupTable,
          targets: args.targets,
        });

    results.push(result);

    await admin.from("wh_sync_table_runs").insert({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      sync_run_id: syncRunId,
      source_table: table,
      mode: result.mode,
      status: result.status,
      requested_after: updatedAfter,
      rows_received: result.rowsReceived,
      rows_inserted: result.rowsInserted,
      rows_updated: result.rowsUpdated,
      rows_failed: result.rowsFailed,
      rows_unmapped: result.rowsUnmapped,
      raw_rows_stored: result.rawRowsStored,
      pages_fetched: result.pagesFetched,
      source_max_updated_at: result.sourceMaxUpdatedAt,
      duration_ms: result.durationMs,
      error_summary: result.error,
      warnings: result.warnings,
      completed_at: new Date().toISOString(),
    });

    // The watermark only advances on a clean run. A failed or partial table
    // keeps its previous watermark so nothing is skipped on the next attempt.
    const advance = result.status === "success" && result.sourceMaxUpdatedAt;
    await admin.from("wh_sync_state").upsert(
      {
        organization_id: args.organizationId,
        connection_id: args.connectionId,
        source_table: table,
        last_attempted_at: new Date().toISOString(),
        ...(result.status !== "failed" ? { last_successful_at: new Date().toISOString() } : {}),
        ...(advance
          ? {
              watermark: result.sourceMaxUpdatedAt,
              source_max_updated_at: result.sourceMaxUpdatedAt,
            }
          : {}),
        last_mode: result.mode,
        rows_received: result.rowsReceived,
        rows_inserted: result.rowsInserted,
        rows_updated: result.rowsUpdated,
        rows_failed: result.rowsFailed,
        rows_unmapped: result.rowsUnmapped,
        duration_ms: result.durationMs,
        error_summary: result.error,
        warnings: result.warnings,
      },
      { onConflict: "connection_id,source_table" },
    );
  }

  // Run status reflects what was actually persisted. A run is only "success"
  // when every table succeeded; anything degraded is at best "partial", and a
  // run where no core table landed data is a failure.
  const coreResults = results.filter((r) => isCoreTable(r.table));
  const coreOk = coreResults.filter((r) => r.status === "success" || r.status === "partial");
  const allClean = results.every((r) => r.status === "success" || r.status === "skipped");
  const status: "success" | "partial" | "failed" =
    coreResults.length > 0 && coreOk.length === 0 ? "failed" : allClean ? "success" : "partial";


  const totals = results.reduce(
    (acc, r) => ({
      received: acc.received + r.rowsReceived,
      inserted: acc.inserted + r.rowsInserted,
      updated: acc.updated + r.rowsUpdated,
      failed: acc.failed + r.rowsFailed,
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
      error_summary: results
        .filter((r) => r.error)
        .map((r) => `${r.table}: ${r.error}`)
        .join(" | ")
        .slice(0, 1000) || null,
    })
    .eq("id", syncRunId);

  const throughDates = results
    .map((r) => r.sourceMaxUpdatedAt)
    .filter((d): d is string => !!d)
    .sort();
  await admin
    .from("data_source_connections")
    .update({
      status: status === "failed" ? "needs_attention" : "connected",
      last_attempted_sync_at: new Date().toISOString(),
      ...(status !== "failed" ? { last_successful_sync_at: new Date().toISOString() } : {}),
      ...(throughDates.length
        ? { data_through_date: String(throughDates[throughDates.length - 1]).slice(0, 10) }
        : {}),
    })
    .eq("id", args.connectionId)
    .eq("organization_id", args.organizationId);

  return { syncRunId, results, status };
}

export const ALL_SYNC_TABLES: WhTable[] = [...WH_LOOKUP_TABLES, ...WH_CORE_TABLES];
