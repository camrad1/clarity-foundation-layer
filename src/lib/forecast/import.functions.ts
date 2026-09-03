/**
 * Admin server functions for the historical weekly-forecast workbook import.
 *
 * SECURITY: both functions require an authenticated session and additionally
 * require can_manage_imports() for the target organization before any
 * privileged (service-role) write happens.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Marker written to every record created by the historical workbook import. */
const SOURCE_TYPE = "historical_forecast_import";

async function guard(supabase: any, organizationId: string) {
  const { data: allowed, error } = await supabase.rpc("can_manage_imports", {
    _org_id: organizationId,
  });
  if (error || allowed !== true) {
    throw new Error("Not permitted to manage imports for this organization");
  }
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

/** Parse the workbook and report what WOULD be imported. Writes nothing. */
export const forecastImportPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fileInput.parse(d))
  .handler(async ({ data, context }) => {
    await guard((context as any).supabase, data.organizationId);
    const { parseForecastWorkbook, normalizeCommunityName } = await import("./parse.server");
    const parsed = parseForecastWorkbook(decodeBase64(data.fileBase64), data.fileName);

    const admin = await adminClient();
    const [{ data: communities }, { data: saved }] = await Promise.all([
      admin.from("communities").select("id, name").eq("organization_id", data.organizationId),
      admin
        .from("forecast_community_mappings")
        .select("normalized_name, community_id, ignored")
        .eq("organization_id", data.organizationId),
    ]);

    const byNorm = new Map<string, { id: string; name: string }>();
    for (const c of communities ?? []) byNorm.set(normalizeCommunityName(c.name), { id: c.id, name: c.name });
    /** Workbook rows use short names ("The Esther") for longer canonical names. */
    function fuzzyMatch(norm: string): { id: string; name: string } | null {
      const hits = [...byNorm.entries()].filter(
        ([k]) => k.startsWith(`${norm} `) || norm.startsWith(`${k} `) || k === norm,
      );
      return hits.length === 1 ? hits[0]![1] : null;
    }
    const savedByNorm = new Map<string, { community_id: string | null; ignored: boolean }>();
    for (const m of saved ?? []) savedByNorm.set(m.normalized_name, m);

    return {
      fileName: parsed.fileName,
      sheetName: parsed.sheetName,
      forecastDates: parsed.forecastDates,
      months: parsed.months,
      eomMonths: parsed.eomMonths,
      correctedDateColumns: parsed.correctedDateColumns,
      ambiguousSamples: parsed.ambiguousSamples,
      stretchRecords: parsed.stretchRecords,
      numericRecords: parsed.numericRecords,
      noteRecords: parsed.noteRecords,
      ambiguousRecords: parsed.ambiguousRecords,
      warnings: parsed.warnings,
      communities: parsed.communities.map((c) => {
        const savedMap = savedByNorm.get(c.normalizedName);
        const exact = byNorm.get(c.normalizedName);
        const fuzzy = exact ? null : fuzzyMatch(c.normalizedName);
        const auto = exact ?? fuzzy ?? undefined;
        const numeric = c.cells.filter((x) => x.projectedMoveIns !== null || x.projectedMoveOuts !== null);
        return {
          sourceName: c.sourceName,
          normalizedName: c.normalizedName,
          numericCells: numeric.length,
          noteCells: c.cells.filter((x) => x.sourceNote).length,
          eomCells: c.eom.length,
          firstDate: numeric[0]?.forecastDate ?? null,
          lastDate: numeric[numeric.length - 1]?.forecastDate ?? null,
          suggestedCommunityId: savedMap?.ignored ? null : (savedMap?.community_id ?? auto?.id ?? null),
          ignored: savedMap?.ignored ?? false,
          matchSource: savedMap ? "saved" : exact ? "exact" : fuzzy ? "fuzzy" : "unmapped",
          stretchCells: c.cells.filter((x) => x.stretchGoal !== null).length,
          ambiguousCells: c.cells.filter((x) => x.ambiguous).length,
        };
      }),
      availableCommunities: (communities ?? []).map((c: any) => ({ id: c.id, name: c.name })),
    };
  });

/** Import the workbook using an explicit source-name -> community mapping. */
export const forecastImportRun = createServerFn({ method: "POST" })
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
          .max(200),
        rememberMappings: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard((context as any).supabase, data.organizationId);
    const userId = (context as any).userId ?? null;
    const { parseForecastWorkbook } = await import("./parse.server");
    const parsed = parseForecastWorkbook(decodeBase64(data.fileBase64), data.fileName);
    const admin = await adminClient();

    const mapping = new Map(data.mappings.map((m) => [m.normalizedName, m]));
    const validIds = new Set<string>(
      ((await admin.from("communities").select("id").eq("organization_id", data.organizationId)).data ?? []).map(
        (c: any) => c.id,
      ),
    );

    const { data: batch, error: batchErr } = await admin
      .from("forecast_import_batches")
      .insert({
        organization_id: data.organizationId,
        source_file_name: data.fileName,
        source_sheet_name: parsed.sheetName,
        forecast_dates_detected: parsed.forecastDates.length,
        communities_detected: parsed.communities.length,
        ambiguous_cells: parsed.ambiguousRecords,
        imported_by: userId,
      })
      .select("id")
      .single();
    if (batchErr || !batch) throw new Error(`Could not start the import batch: ${batchErr?.message}`);

    let imported = 0;
    let notes = 0;
    let stretch = 0;
    let skipped = 0;
    let protectedManual = 0;
    let alreadyPresent = 0;
    const unmapped: string[] = [];

    for (const community of parsed.communities) {
      const m = mapping.get(community.normalizedName);
      if (!m || m.ignored || !m.communityId || !validIds.has(m.communityId)) {
        if (!m?.ignored) unmapped.push(community.sourceName);
        skipped += community.cells.length;
        continue;
      }

      // never silently overwrite a manually entered Monday-call forecast
      const { data: existing } = await admin
        .from("forecast_weekly_entries")
        .select("forecast_date, source_type")
        .eq("organization_id", data.organizationId)
        .eq("community_id", m.communityId);
      const manualDates = new Set(
        (existing ?? [])
          .filter((e: any) => e.source_type && e.source_type !== SOURCE_TYPE)
          .map((e: any) => String(e.forecast_date)),
      );
      const importedDates = new Set(
        (existing ?? [])
          .filter((e: any) => e.source_type === SOURCE_TYPE)
          .map((e: any) => String(e.forecast_date)),
      );

      // Idempotency: a historical week already imported is left exactly as it
      // is. Manually entered Monday-call forecasts are never overwritten.
      const importable = community.cells.filter((c) => {
        if (manualDates.has(c.forecastDate)) {
          protectedManual += 1;
          return false;
        }
        if (importedDates.has(c.forecastDate)) {
          alreadyPresent += 1;
          return false;
        }
        return true;
      });

      const rows = importable.map((cell) => ({
        organization_id: data.organizationId,
        community_id: m.communityId,
        forecast_month: `${cell.forecastDate.slice(0, 7)}-01`,
        forecast_date: cell.forecastDate,
        projected_move_ins: cell.projectedMoveIns,
        projected_move_outs: cell.projectedMoveOuts,
        stretch_goal: cell.stretchGoal,
        historical_source_note: cell.sourceNote,
        source_type: SOURCE_TYPE,
        source_file_name: data.fileName,
        import_batch_id: batch.id,
        entered_by: userId,
      }));
      notes += rows.filter((r) => r.historical_source_note).length;
      stretch += rows.filter((r) => r.stretch_goal !== null).length;
      if (!rows.length) continue;

      for (let i = 0; i < rows.length; i += 300) {
        const chunk = rows.slice(i, i + 300);
        const { error } = await admin
          .from("forecast_weekly_entries")
          .upsert(chunk, {
            onConflict: "organization_id,community_id,forecast_date",
            ignoreDuplicates: true,
          });
        if (error) throw new Error(`Import failed while writing forecasts: ${error.message}`);
        imported += chunk.length;
      }

      // Spreadsheet month-end values are reference data only; validated
      // WelcomeHome actuals remain the canonical EOM Actual.
      const eomRows = community.eom.map((e) => ({
        organization_id: data.organizationId,
        community_id: m.communityId,
        forecast_month: e.month,
        source_move_ins: e.moveIns,
        source_move_outs: e.moveOuts,
        source_note: e.sourceNote,
        source_file_name: data.fileName,
        import_batch_id: batch.id,
      }));
      if (eomRows.length) {
        const { error } = await admin
          .from("forecast_eom_source_values")
          .upsert(eomRows, {
            onConflict: "organization_id,community_id,forecast_month",
            ignoreDuplicates: true,
          });
        if (error) throw new Error(`Import failed while writing month-end reference values: ${error.message}`);
      }

      if (data.rememberMappings) {
        await admin.from("forecast_community_mappings").upsert(
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
        await admin.from("forecast_community_mappings").upsert(
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
      notes,
      stretch,
      protectedManual,
      alreadyPresent,
      skipped,
      unmapped,
      ambiguous: parsed.ambiguousRecords,
      warnings: parsed.warnings,
      forecastDates: parsed.forecastDates,
    };

    await admin
      .from("forecast_import_batches")
      .update({
        records_imported: imported,
        notes_imported: notes,
        rows_skipped: skipped,
        unmapped_communities: unmapped,
        report,
      })
      .eq("id", batch.id);

    return { ok: true as const, batchId: batch.id as string, ...report };
  });
