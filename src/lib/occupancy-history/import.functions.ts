/**
 * Admin server functions for the official daily occupancy history backfill.
 *
 * SECURITY: every function requires an authenticated session and additionally
 * requires can_manage_imports() for the target organization before any
 * privileged (service-role) write happens. The September 2, 2026 cutoff is
 * enforced here on the server, never in the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CUTOFF = "2026-09-02";

async function guard(supabase: any, organizationId: string) {
  const { data: allowed, error } = await supabase.rpc("can_manage_imports", { _org_id: organizationId });
  if (error || allowed !== true) throw new Error("Not permitted to manage imports for this organization");
  return organizationId;
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const fileInput = z.object({
  organizationId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  fileBase64: z.string().min(1),
});

/** Parse a workbook and report what WOULD be imported. Writes nothing. */
export const occHistoryPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fileInput.parse(d))
  .handler(async ({ data, context }) => {
    await guard((context as any).supabase, data.organizationId);
    const { parseOccupancyWorkbook, normalizeCommunityName } = await import("./parse.server");
    const parsed = parseOccupancyWorkbook(decodeBase64(data.fileBase64), data.fileName, CUTOFF);

    const admin = await adminClient();
    const [{ data: communities }, { data: saved }] = await Promise.all([
      admin.from("communities").select("id, name").eq("organization_id", data.organizationId),
      admin
        .from("occupancy_history_community_mappings")
        .select("normalized_name, community_id, ignored")
        .eq("organization_id", data.organizationId),
    ]);

    const byNorm = new Map<string, { id: string; name: string }>();
    for (const c of communities ?? []) byNorm.set(normalizeCommunityName(c.name), { id: c.id, name: c.name });
    const savedByNorm = new Map<string, { community_id: string | null; ignored: boolean }>();
    for (const m of saved ?? []) savedByNorm.set(m.normalized_name, m);

    return {
      sheetName: parsed.sheetName,
      fileName: parsed.fileName,
      year: parsed.year,
      rangeStart: parsed.rangeStart,
      rangeEnd: parsed.rangeEnd,
      cutoff: CUTOFF,
      futureRowsSkipped: parsed.futureRowsSkipped,
      rollupRowsSkipped: parsed.rollupRowsSkipped,
      warnings: parsed.warnings,
      communities: parsed.communities.map((c) => {
        const savedMap = savedByNorm.get(c.normalizedName);
        const auto = byNorm.get(c.normalizedName);
        return {
          sourceName: c.sourceName,
          normalizedName: c.normalizedName,
          days: c.days.length,
          firstDate: c.firstDate,
          lastDate: c.lastDate,
          futureRowsSkipped: c.futureRowsSkipped,
          warningDays: c.days.filter((d) => d.validationStatus !== "ok").length,
          suggestedCommunityId: savedMap?.ignored ? null : (savedMap?.community_id ?? auto?.id ?? null),
          suggestedCommunityName: savedMap?.ignored
            ? null
            : ((savedMap?.community_id
                ? (communities ?? []).find((x: any) => x.id === savedMap.community_id)?.name
                : auto?.name) ?? null),
          ignored: savedMap?.ignored ?? false,
          matchSource: savedMap ? "saved" : auto ? "auto" : "unmapped",
        };
      }),
      availableCommunities: (communities ?? []).map((c: any) => ({ id: c.id, name: c.name })),
    };
  });

/** Import a workbook using an explicit source-name -> community mapping. */
export const occHistoryImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    fileInput
      .extend({
        mappings: z
          .array(
            z.object({
              normalizedName: z.string().min(1),
              sourceName: z.string().min(1),
              communityId: z.string().uuid().nullable(),
              ignored: z.boolean().default(false),
            }),
          )
          .max(100),
        rememberMappings: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard((context as any).supabase, data.organizationId);
    const userId = (context as any).userId ?? null;
    const { parseOccupancyWorkbook } = await import("./parse.server");
    const parsed = parseOccupancyWorkbook(decodeBase64(data.fileBase64), data.fileName, CUTOFF);
    const admin = await adminClient();

    const mapping = new Map(data.mappings.map((m) => [m.normalizedName, m]));
    const validIds = new Set<string>(
      ((await admin.from("communities").select("id").eq("organization_id", data.organizationId)).data ?? []).map(
        (c: any) => c.id,
      ),
    );

    const { data: batch, error: batchErr } = await admin
      .from("occupancy_history_import_batches")
      .insert({
        organization_id: data.organizationId,
        source_file_name: data.fileName,
        source_sheet_name: parsed.sheetName,
        source_year: parsed.year,
        source_range_start: parsed.rangeStart,
        source_range_end: parsed.rangeEnd,
        cutoff_date: CUTOFF,
        future_rows_skipped: parsed.futureRowsSkipped,
        mapping_used: Object.fromEntries(data.mappings.map((m) => [m.sourceName, m.ignored ? "ignored" : m.communityId])),
        imported_by: userId,
      })
      .select("id")
      .single();
    if (batchErr || !batch) throw new Error(`Could not start the import batch: ${batchErr?.message}`);

    let imported = 0;
    let warningRows = 0;
    let skipped = 0;
    const unmapped: string[] = [];
    const importedCommunities = new Set<string>();

    for (const community of parsed.communities) {
      const m = mapping.get(community.normalizedName);
      if (!m || m.ignored || !m.communityId || !validIds.has(m.communityId)) {
        if (!m?.ignored) unmapped.push(community.sourceName);
        skipped += community.days.length;
        continue;
      }
      const rows = community.days.map((d) => ({
        organization_id: data.organizationId,
        community_id: m.communityId,
        occupancy_date: d.date,
        source_type: "official_daily_backfill",
        beginning_occupied_units: d.beginningOccupied,
        move_ins: d.moveIns,
        move_outs: d.moveOuts,
        net_move_ins_move_outs: d.net,
        ending_occupied_units: d.endingOccupied,
        beginning_occupancy_pct: d.beginningPct,
        ending_occupancy_pct: d.endingPct,
        total_units: d.totalUnits,
        raw_source_community_name: community.sourceName,
        raw_source_date_label: d.dateLabel,
        validation_status: d.validationStatus,
        notes: d.notes,
        source_file_name: data.fileName,
        source_sheet_name: parsed.sheetName,
        import_batch_id: batch.id,
        imported_by: userId,
        imported_at: new Date().toISOString(),
      }));
      warningRows += rows.filter((r) => r.validation_status !== "ok").length;

      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const { error } = await admin
          .from("community_daily_occupancy_history")
          .upsert(chunk, { onConflict: "organization_id,community_id,occupancy_date,source_type" });
        if (error) throw new Error(`Import failed while writing history: ${error.message}`);
        imported += chunk.length;
      }
      if (rows.length) importedCommunities.add(m.communityId);

      if (data.rememberMappings) {
        await admin.from("occupancy_history_community_mappings").upsert(
          {
            organization_id: data.organizationId,
            source_community_name: community.sourceName,
            normalized_name: community.normalizedName,
            community_id: m.communityId,
            ignored: false,
            created_by: userId,
          },
          { onConflict: "organization_id,normalized_name" },
        );
      }
    }

    if (data.rememberMappings) {
      for (const m of data.mappings.filter((x) => x.ignored)) {
        await admin.from("occupancy_history_community_mappings").upsert(
          {
            organization_id: data.organizationId,
            source_community_name: m.sourceName,
            normalized_name: m.normalizedName,
            community_id: null,
            ignored: true,
            created_by: userId,
          },
          { onConflict: "organization_id,normalized_name" },
        );
      }
    }

    const report = {
      imported,
      skipped,
      unmapped,
      futureRowsSkipped: parsed.futureRowsSkipped,
      rollupRowsSkipped: parsed.rollupRowsSkipped,
      warnings: parsed.warnings,
      warningRows,
      rangeStart: parsed.rangeStart,
      rangeEnd: parsed.rangeEnd,
    };

    await admin
      .from("occupancy_history_import_batches")
      .update({
        records_imported: imported,
        rows_skipped: skipped,
        unmapped_communities: unmapped,
        communities_imported: importedCommunities.size,
        validation_warnings: warningRows,
        report,
      })
      .eq("id", batch.id);

    return { ok: true as const, batchId: batch.id as string, ...report };
  });

/** Remove every record written by one import batch (re-import safe). */
export const occHistoryDeleteBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ organizationId: z.string().uuid(), batchId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard((context as any).supabase, data.organizationId);
    const admin = await adminClient();
    const { error } = await admin
      .from("community_daily_occupancy_history")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("import_batch_id", data.batchId);
    if (error) throw new Error(error.message);
    await admin
      .from("occupancy_history_import_batches")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("id", data.batchId);
    return { ok: true as const };
  });
