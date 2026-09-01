import { supabase } from "@/integrations/supabase/client";
import { normalizeQuery, normalizeUrl } from "./normalize";
import type { GrainKey, MetricRow, ParsedFile } from "./parse";

/**
 * Import writer.
 *
 * Idempotency: (connection_id, file_hash) is unique for non-failed imports, so
 * re-uploading the exact same export is detected and rejected before any fact
 * row is written.
 *
 * Overlap rule: each grain of a new import supersedes previously active grains
 * of the SAME connection whose exported period overlaps (database trigger
 * `t_gsc_supersede`). Older imports are retained for audit but excluded from
 * dashboards, so overlapping uploads can never double count.
 */

export type ImportPeriod = { start: string; end: string };

export type ImportOutcome =
  | { status: "duplicate"; importId: string; fileName: string }
  | { status: "imported"; importId: string; rowCounts: Record<string, number>; warnings: string[] }
  | { status: "failed"; message: string; importId?: string };

const CHUNK = 500;

async function insertChunks(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from(table as never)
      .insert(rows.slice(i, i + CHUNK) as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

function factRows(
  grain: GrainKey,
  rows: MetricRow[],
  base: { organization_id: string; import_id: string },
) {
  return rows.map((r) => {
    const metrics = {
      ...base,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    };
    switch (grain) {
      case "daily":
        return { ...metrics, date: r.key };
      case "query":
        return { ...metrics, query: r.key, normalized_query: normalizeQuery(r.key) };
      case "page":
        return { ...metrics, page_url: r.key, normalized_url: normalizeUrl(r.key) };
      case "device":
        return { ...metrics, device: r.key };
      case "country":
        return { ...metrics, country: r.key };
      case "search_appearance":
        return { ...metrics, search_appearance: r.key };
    }
  });
}

const TABLE_FOR_GRAIN: Record<GrainKey, string> = {
  daily: "gsc_daily_facts",
  query: "gsc_query_facts",
  page: "gsc_page_facts",
  device: "gsc_device_facts",
  country: "gsc_country_facts",
  search_appearance: "gsc_search_appearance_facts",
};

export async function findDuplicateImport(connectionId: string, fileHash: string) {
  const { data } = await supabase
    .from("gsc_imports")
    .select("id, file_name, imported_at, import_status")
    .eq("connection_id", connectionId)
    .eq("file_hash", fileHash)
    .neq("import_status", "failed")
    .maybeSingle();
  return data ?? null;
}

export async function runGscImport(args: {
  organizationId: string;
  connectionId: string;
  parsed: ParsedFile;
  /** Period the aggregate (non daily) reports cover. */
  period: ImportPeriod;
}): Promise<ImportOutcome> {
  const { organizationId, connectionId, parsed, period } = args;

  if (parsed.errors.length) return { status: "failed", message: parsed.errors.join(" ") };

  const duplicate = await findDuplicateImport(connectionId, parsed.fileHash);
  if (duplicate)
    return { status: "duplicate", importId: duplicate.id, fileName: duplicate.file_name };

  const { data: user } = await supabase.auth.getUser();

  const { data: created, error: importError } = await supabase
    .from("gsc_imports")
    .insert({
      organization_id: organizationId,
      connection_id: connectionId,
      file_name: parsed.fileName,
      file_hash: parsed.fileHash,
      file_size_bytes: parsed.sizeBytes,
      data_start_date: parsed.dataStartDate ?? period.start,
      data_end_date: parsed.dataEndDate ?? period.end,
      import_status: "pending",
      created_by: user.user?.id ?? null,
      warnings: parsed.warnings,
      metadata: {
        detected_reports: parsed.grains.map((g) => g.grain),
        aggregate_period: period,
      },
    })
    .select("id")
    .single();

  if (importError || !created)
    return { status: "failed", message: importError?.message ?? "Could not create the import." };

  const importId = created.id;
  const rowCounts: Record<string, number> = {};

  try {
    for (const grain of parsed.grains) {
      const rows = factRows(grain.grain, grain.rows, {
        organization_id: organizationId,
        import_id: importId,
      });
      await insertChunks(TABLE_FOR_GRAIN[grain.grain], rows as Record<string, unknown>[]);
      rowCounts[grain.grain] = rows.length;
    }

    // Page mapping runs against the existing url_mapping_rules; unmatched URLs
    // deliberately stay unmapped.
    if (parsed.grains.some((g) => g.grain === "page")) {
      await supabase.rpc("gsc_apply_page_mappings", { _import_id: importId });
    }

    const grainRows = parsed.grains.map((g) => {
      const dates = g.grain === "daily" ? g.rows.map((r) => r.key).sort() : null;
      return {
        organization_id: organizationId,
        connection_id: connectionId,
        import_id: importId,
        grain: g.grain,
        row_count: g.rows.length,
        period_start: (dates ? dates[0] : period.start) ?? period.start,
        period_end: (dates ? dates[dates.length - 1] : period.end) ?? period.end,
        source_file: g.sourceFile,
        is_active: true,
      };
    });
    const { error: grainError } = await supabase.from("gsc_import_grains").insert(grainRows);
    if (grainError) throw new Error(grainError.message);

    await supabase
      .from("gsc_imports")
      .update({ import_status: "imported", metadata: { row_counts: rowCounts, detected_reports: parsed.grains.map((g) => g.grain), aggregate_period: period } })
      .eq("id", importId);

    const through = parsed.dataEndDate ?? period.end;
    await supabase
      .from("data_source_connections")
      .update({
        status: "manual_upload",
        last_successful_sync_at: new Date().toISOString(),
        last_attempted_sync_at: new Date().toISOString(),
        data_through_date: through,
      })
      .eq("id", connectionId);

    return { status: "imported", importId, rowCounts, warnings: parsed.warnings };
  } catch (e) {
    const message = (e as Error).message;
    await supabase
      .from("gsc_imports")
      .update({ import_status: "failed", error_summary: message })
      .eq("id", importId);
    return { status: "failed", message, importId };
  }
}

/** Re-applies URL mapping rules to an import's page rows. */
export async function reapplyPageMappings(importId: string) {
  const { data, error } = await supabase.rpc("gsc_apply_page_mappings", { _import_id: importId });
  if (error) throw error;
  return data ?? 0;
}
