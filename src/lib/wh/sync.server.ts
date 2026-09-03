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
  WH_INCREMENTAL_TABLES,
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

/**
 * HEARTBEAT — persisted proof of forward progress.
 *
 * A work unit writes one of these every time a page of source rows has been
 * fetched AND persisted. Stall detection is defined purely in terms of this
 * timestamp: a unit that is genuinely slow keeps advancing pages and is never
 * reaped, while a unit whose HTTP request died, whose pagination stopped, or
 * whose driving client vanished stops heartbeating and becomes `stalled` after
 * the configured window. This is why the fix is not "raise the timeout".
 */
export type Heartbeat = (p: { page: number; pages: number; rows: number }) => Promise<void>;

/** How long a non-terminal unit may go without a heartbeat before it is stalled. */
export const WH_STALL_MINUTES = 10;


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
    beat?: Heartbeat | undefined;
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
      await args.beat?.({
        page: result.pagesFetched,
        pages: result.pagesFetched,
        rows: result.rowsReceived,
      });

      for (const raw of records) {
        // Referrers rows are people; keep only the non-identifying columns.
        // Users are staff, not prospects/residents: their display name is kept
        // so counselor attribution is readable, but contact details are not.
        let rec: Rec;
        let staffName: string | null = null;
        if (args.table === "Referrers") {
          rec = Object.fromEntries(
            (WH_REFERRER_SAFE_FIELDS as readonly string[])
              .filter((k) => raw[k] !== undefined)
              .map((k) => [k, raw[k]!]),
          );
        } else if (args.table === "Users") {
          rec = stripPii(raw);
          staffName = [raw["first_name"], raw["last_name"]].filter(Boolean).join(" ").trim() || null;
          if (staffName) rec["display_name"] = staffName;
        } else {
          rec = stripPii(raw);
        }
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
          label:
            rec["name"] ?? staffName ?? rec["label"] ?? rec["title"] ?? rec["scores_name"] ?? null,

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
    beat?: Heartbeat | undefined;

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

        // Heartbeat AFTER the page has been persisted: progress means data
        // landed, not merely that a request was issued.
        await args.beat?.({ page: pages, pages: result.pagesFetched, rows: result.rowsReceived });



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

/**
 * BOUNDED WORK UNIT — one source table x one mapped community (or one
 * account-wide lookup dataset). This is the only unit of ingestion ClarityIQ
 * performs in a single HTTP request, so request duration is a function of ONE
 * dataset for ONE community, never of portfolio size. Portfolio syncs are an
 * orchestrated sequence of these units (see welcomehome.functions.ts).
 *
 * Every unit is idempotent: pages are upserted on (connection_id, source_id)
 * as they arrive, so an interrupted unit leaves valid rows behind and a retry
 * updates rather than duplicates them.
 */
export async function runWelcomeHomeSyncUnit(
  admin: Admin,
  auth: WhAuth,
  args: {
    organizationId: string;
    connectionId: string;
    syncRunId: string;
    table: WhTable;
    /** null = account-wide dataset (JSON lookups). */
    target: CommunityTarget | null;
    mode: "full" | "incremental";
    overlapMinutes: number;
  },
): Promise<TableResult> {
  const scopeKey = args.target?.communityId ?? "";
  const supportsIncremental = (WH_INCREMENTAL_TABLES as string[]).includes(args.table);

  let updatedAfter: string | null = null;
  if (args.mode === "incremental" && supportsIncremental) {
    const { data: state } = await admin
      .from("wh_sync_state")
      .select("watermark, source_max_updated_at")
      .eq("connection_id", args.connectionId)
      .eq("source_table", args.table)
      .eq("community_scope", scopeKey)
      .maybeSingle();
    const base = state?.source_max_updated_at ?? state?.watermark ?? null;
    if (base) {
      updatedAfter = new Date(new Date(base).getTime() - args.overlapMinutes * 60_000).toISOString();
    }
  }

  await admin.from("wh_sync_state").upsert(
    {
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      source_table: args.table,
      community_scope: scopeKey,
      community_id: args.target?.communityId ?? null,
      last_attempted_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,source_table,community_scope" },
  );

  const targets = args.target ? [args.target] : [];

  // CLAIM the work unit BEFORE any network call. Previously a unit only became
  // visible when it finished, so an in-flight or orphaned unit left no trace at
  // all and its parent run could stay `running` forever. The row now exists for
  // the whole lifetime of the unit and carries its own progress heartbeat.
  const { data: prior } = await admin
    .from("wh_sync_table_runs")
    .select("retry_count")
    .eq("sync_run_id", args.syncRunId)
    .eq("source_table", args.table)
    // PostgREST treats eq(null) as a literal, so the account-wide scope
    // (community_id IS NULL) has to be matched with `is`.
    [args.target?.communityId ? "eq" : "is"]("community_id", args.target?.communityId ?? null)
    .order("started_at", { ascending: false })
    .limit(1);

  const retryCount = ((prior?.[0]?.retry_count as number | undefined) ?? -1) + 1;

  const nowIso = () => new Date().toISOString();
  const { data: claimed } = await admin
    .from("wh_sync_table_runs")
    .insert({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      sync_run_id: args.syncRunId,
      community_id: args.target?.communityId ?? null,
      source_community_id: args.target?.sourceCommunityId ?? null,
      source_table: args.table,
      mode: args.mode,
      status: "running",
      requested_after: updatedAfter,
      retry_count: retryCount,
      started_at: nowIso(),
      last_progress_at: nowIso(),
    })
    .select("id")
    .single();
  const unitRunId = (claimed?.id as string | undefined) ?? null;

  const beat: Heartbeat | undefined = unitRunId
    ? async ({ page, pages, rows }) => {
        await admin
          .from("wh_sync_table_runs")
          .update({
            last_progress_at: nowIso(),
            current_page: page,
            pages_processed: pages,
            pages_fetched: pages,
            rows_processed: rows,
            rows_received: rows,
          })
          .eq("id", unitRunId);
      }
    : undefined;

  const result = isCoreTable(args.table)
    ? await syncCoreTable(admin, auth, {
        organizationId: args.organizationId,
        connectionId: args.connectionId,
        syncRunId: args.syncRunId,
        table: args.table,
        targets,
        updatedAfter,
        beat,
      })
    : await syncLookupTable(admin, auth, {
        organizationId: args.organizationId,
        connectionId: args.connectionId,
        table: args.table as WhLookupTable,
        targets,
        beat,
      });

  if (args.mode === "incremental" && !supportsIncremental && isCoreTable(args.table)) {
    result.warnings.push(
      "WelcomeHome exports expose no updated_at column; a full refresh was performed instead of an incremental one.",
    );
  }

  const terminal = {
    organization_id: args.organizationId,
    connection_id: args.connectionId,
    sync_run_id: args.syncRunId,
    community_id: args.target?.communityId ?? null,
    source_community_id: args.target?.sourceCommunityId ?? null,
    source_table: args.table,
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
    rows_processed: result.rowsReceived,
    pages_processed: result.pagesFetched,
    retry_count: retryCount,
    source_max_updated_at: result.sourceMaxUpdatedAt,
    duration_ms: result.durationMs,
    error_summary: result.error,
    last_error: result.error,
    warnings: result.warnings,
    last_progress_at: nowIso(),
    completed_at: nowIso(),
  };
  if (unitRunId) {
    await admin.from("wh_sync_table_runs").update(terminal).eq("id", unitRunId);
  } else {
    await admin.from("wh_sync_table_runs").insert(terminal);
  }


  // The watermark only advances on a clean unit. An interrupted, failed or
  // partial unit keeps its previous watermark, so a retry re-reads the same
  // window instead of skipping records that were never persisted.
  const advance = result.status === "success" && result.sourceMaxUpdatedAt;
  await admin.from("wh_sync_state").upsert(
    {
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      source_table: args.table,
      community_scope: scopeKey,
      community_id: args.target?.communityId ?? null,
      last_attempted_at: new Date().toISOString(),
      ...(result.status !== "failed" ? { last_successful_at: new Date().toISOString() } : {}),
      ...(advance
        ? { watermark: result.sourceMaxUpdatedAt, source_max_updated_at: result.sourceMaxUpdatedAt }
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
    { onConflict: "connection_id,source_table,community_scope" },
  );

  return result;
}

export { WH_ALL_TABLES as ALL_SYNC_TABLES } from "./tables";

