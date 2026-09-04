import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Period } from "./compare";
import type { GrainKey } from "./parse";

/**
 * Read layer for Search Intelligence. All aggregation happens in the database
 * (see the gsc_* functions) so the browser never downloads raw rows just to
 * sum them, and row level security remains the only access boundary.
 */

export type GrainImport = {
  id: string;
  import_id: string;
  grain: GrainKey;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  is_active: boolean;
  source_file: string | null;
  gsc_imports: {
    file_name: string;
    imported_at: string;
    import_status: string;
    connection_id: string;
  } | null;
};

export function useGrainImports(organizationId: string | null, grain: GrainKey) {
  return useQuery({
    queryKey: ["gsc_grain_imports", organizationId, grain],
    enabled: !!organizationId,
    queryFn: async (): Promise<GrainImport[]> => {
      const { data, error } = await supabase
        .from("gsc_import_grains")
        .select(
          "id, import_id, grain, period_start, period_end, row_count, is_active, source_file, gsc_imports(file_name, imported_at, import_status, connection_id)",
        )
        .eq("organization_id", organizationId!)
        .eq("grain", grain)
        .order("period_end", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as GrainImport[];
    },
  });
}

export type ImportSelection = {
  current: GrainImport | null;
  comparison: GrainImport | null;
  /**
   * exact  — the export's own period equals the globally selected range
   * manual — the user deliberately opened a different imported export
   * none   — no export matches the selected range; nothing is shown by default
   */
  coverage: "exact" | "manual" | "none";
  /** Every active export of this grain, newest first, for the period picker. */
  options: GrainImport[];
};

/**
 * Aggregate exports (Queries, Pages, Devices, Countries, Search appearance)
 * carry no row level dates: each file is a single fixed-period total. They are
 * therefore never prorated, split across dates or substituted for a different
 * period. An export is used automatically ONLY when its exported period equals
 * the globally selected range; otherwise the caller shows a "no matching
 * export" state and the user can intentionally open an older export.
 */
export function selectImportForPeriod(
  grains: GrainImport[],
  period: Period,
  overrideImportId?: string | null,
): ImportSelection {
  const options = grains
    .filter((g) => g.is_active && g.period_start && g.period_end)
    .sort((a, b) => (a.period_end! < b.period_end! ? 1 : -1));

  const override = overrideImportId
    ? (options.find((g) => g.import_id === overrideImportId) ?? null)
    : null;
  const exact =
    options.find((g) => g.period_start === period.start && g.period_end === period.end) ?? null;

  const current = override ?? exact;
  if (!current) return { current: null, comparison: null, coverage: "none", options };

  const comparison =
    options.find((g) => g.id !== current.id && g.period_end! < current.period_start!) ?? null;

  return {
    current,
    comparison,
    coverage: current === exact ? "exact" : "manual",
    options,
  };
}


export function useDailyTotals(organizationId: string | null, period: Period | null) {
  return useQuery({
    queryKey: ["gsc_daily_totals", organizationId, period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_daily_totals", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
      });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });
}

export function useDailySeries(organizationId: string | null, period: Period | null) {
  return useQuery({
    queryKey: ["gsc_daily_series", organizationId, period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_daily_series", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useQueryReport(
  organizationId: string | null,
  importId: string | null,
  compareImportId: string | null,
) {
  return useQuery({
    queryKey: ["gsc_query_report", organizationId, importId, compareImportId],
    enabled: !!organizationId && !!importId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_query_report", {
        _org_id: organizationId!,
        _import_id: importId!,
        ...(compareImportId ? { _compare_import_id: compareImportId } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePageReport(
  organizationId: string | null,
  importId: string | null,
  compareImportId: string | null,
) {
  return useQuery({
    queryKey: ["gsc_page_report", organizationId, importId, compareImportId],
    enabled: !!organizationId && !!importId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_page_report", {
        _org_id: organizationId!,
        _import_id: importId!,
        ...(compareImportId ? { _compare_import_id: compareImportId } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

type SimpleGrainTable =
  | "gsc_device_facts"
  | "gsc_country_facts"
  | "gsc_search_appearance_facts";

export function useSimpleGrain(
  table: SimpleGrainTable,
  dimension: "device" | "country" | "search_appearance",
  importId: string | null,
) {
  return useQuery({
    queryKey: ["gsc_simple_grain", table, importId],
    enabled: !!importId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select(`${dimension}, clicks, impressions, ctr, position`)
        .eq("import_id", importId!)
        .order("impressions", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as {
        clicks: number;
        impressions: number;
        ctr: number | null;
        position: number | null;
      }[] & Record<string, unknown>[];
    },
  });
}

export function useGscImports(organizationId: string | null) {
  return useQuery({
    queryKey: ["gsc_imports", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gsc_imports")
        .select(
          "*, data_source_connections(display_name), gsc_import_grains(grain, row_count, is_active, period_start, period_end)",
        )
        .eq("organization_id", organizationId!)
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useQueryClassificationRules(organizationId: string | null) {
  return useQuery({
    queryKey: ["gsc_query_rules", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gsc_query_classification_rules")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("priority");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type ActiveGrainCoverage = {
  grain: GrainKey;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  source_file: string | null;
  file_name: string | null;
  imported_at: string | null;
};

/**
 * Coverage reported by Data Health is the coverage dashboards actually use:
 * only ACTIVE grains of successfully imported files. Superseded grains stay in
 * import history but never widen the reported range.
 */
export function useActiveGrainCoverage(organizationId: string | null) {
  return useQuery({
    queryKey: ["gsc_active_coverage", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<ActiveGrainCoverage[]> => {
      const { data, error } = await supabase
        .from("gsc_import_grains")
        .select(
          "grain, period_start, period_end, row_count, source_file, gsc_imports!inner(file_name, imported_at, import_status)",
        )
        .eq("organization_id", organizationId!)
        .eq("is_active", true)
        .eq("gsc_imports.import_status", "imported");
      if (error) throw error;
      const rows = (data ?? []) as unknown as (Omit<
        ActiveGrainCoverage,
        "file_name" | "imported_at"
      > & { gsc_imports: { file_name: string; imported_at: string } | null })[];
      return rows.map((r) => ({
        grain: r.grain,
        period_start: r.period_start,
        period_end: r.period_end,
        row_count: r.row_count,
        source_file: r.source_file,
        file_name: r.gsc_imports?.file_name ?? null,
        imported_at: r.gsc_imports?.imported_at ?? null,
      }));
    },
  });
}
