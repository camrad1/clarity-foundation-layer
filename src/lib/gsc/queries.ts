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
  /** How well the active export matches the globally selected date range. */
  coverage: "exact" | "fixed_period" | "none";
};

/**
 * Aggregate exports (Queries, Pages, Devices, Countries, Search appearance)
 * represent a FIXED exported period. They are never prorated to a sub-range:
 * the export whose period best overlaps the requested range is selected and
 * its real period is displayed.
 */
export function selectImportForPeriod(
  grains: GrainImport[],
  period: Period,
): ImportSelection {
  const active = grains.filter((g) => g.is_active && g.period_start && g.period_end);
  const overlapping = active
    .map((g) => {
      const start = g.period_start!;
      const end = g.period_end!;
      const overlap =
        start <= period.end && end >= period.start
          ? Math.min(Date.parse(end), Date.parse(period.end)) -
            Math.max(Date.parse(start), Date.parse(period.start))
          : -1;
      return { g, overlap };
    })
    .filter((x) => x.overlap >= 0)
    .sort((a, b) => b.overlap - a.overlap);

  const current = overlapping[0]?.g ?? null;
  if (!current) return { current: null, comparison: null, coverage: "none" };

  const comparison =
    active
      .filter((g) => g.id !== current.id && g.period_end! < current.period_start!)
      .sort((a, b) => (a.period_end! < b.period_end! ? 1 : -1))[0] ?? null;

  const coverage =
    current.period_start === period.start && current.period_end === period.end
      ? "exact"
      : "fixed_period";

  return { current, comparison, coverage };
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
        _compare_import_id: compareImportId ?? undefined,
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
        _compare_import_id: compareImportId ?? undefined,
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
