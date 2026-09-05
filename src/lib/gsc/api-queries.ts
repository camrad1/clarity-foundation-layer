import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Period } from "./compare";
import type { GrainKey } from "./parse";
import {
  selectImportForPeriod,
  useDailySeries,
  useDailyTotals,
  useGrainImports,
  usePageReport,
  useQueryReport,
  useSimpleGrain,
  type ImportSelection,
} from "./queries";

/**
 * Canonical Search Console read layer.
 *
 * Rows pulled through the Search Console API carry their real calendar date,
 * so every report can be aggregated for the exact globally selected range.
 * The manual spreadsheet imports remain untouched and are used only as a
 * clearly labelled fallback for periods the API layer does not cover.
 */

export type ApiGrain =
  "date" | "query" | "page" | "query_page" | "device" | "country" | "search_appearance";

export type GscSource = "api" | "manual" | "none";

export const SOURCE_LABELS: Record<GscSource, string> = {
  api: "Source: Search Console API",
  manual: "Source: Manual Search Console import",
  none: "No Search Console data",
};

export type ApiCoverageRow = {
  grain: string;
  first_date: string | null;
  last_date: string | null;
  row_count: number;
};

export function useGscApiCoverage(organizationId: string | null) {
  return useQuery({
    queryKey: ["gsc_api_coverage", organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ApiCoverageRow[]> => {
      const { data, error } = await supabase.rpc("gsc_api_coverage", {
        _org_id: organizationId!,
      });
      if (error) throw error;
      return (data ?? []) as ApiCoverageRow[];
    },
  });
}

export type ApiCoverage = {
  /** full — the API holds every day of the range; partial — some days. */
  extent: "full" | "partial" | "none";
  first: string | null;
  last: string | null;
};

export function coverageFor(
  rows: ApiCoverageRow[] | undefined,
  grain: ApiGrain,
  period: Period,
): ApiCoverage {
  const row = (rows ?? []).find((r) => r.grain === grain);
  if (!row?.first_date || !row.last_date || !row.row_count)
    return { extent: "none", first: null, last: null };
  const overlaps = row.first_date <= period.end && row.last_date >= period.start;
  if (!overlaps) return { extent: "none", first: row.first_date, last: row.last_date };
  const full = row.first_date <= period.start && row.last_date >= period.end;
  return { extent: full ? "full" : "partial", first: row.first_date, last: row.last_date };
}

/* ---------------------------------------------------------------- raw API */

function useApiDailyTotals(organizationId: string | null, period: Period | null) {
  return useQuery({
    queryKey: ["gsc_api_daily_totals", organizationId, period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_api_daily_totals", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
      });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });
}

function useApiDailySeries(organizationId: string | null, period: Period | null) {
  return useQuery({
    queryKey: ["gsc_api_daily_series", organizationId, period?.start, period?.end],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_api_daily_series", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const PAGE_SIZE = 1000;

/**
 * PostgREST caps a single response at 1,000 rows, so long reports are read in
 * ordered pages rather than silently truncated at the cap.
 */
function useApiQueryReport(
  organizationId: string | null,
  period: Period | null,
  comparison: Period | null,
  limit = 5000,
) {
  return useQuery({
    queryKey: [
      "gsc_api_query_report",
      organizationId,
      period?.start,
      period?.end,
      comparison?.start,
      comparison?.end,
      limit,
    ],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const out: unknown[] = [];
      for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .rpc("gsc_api_query_report", {
            _org_id: organizationId!,
            _start: period!.start,
            _end: period!.end,
            ...(comparison
              ? { _compare_start: comparison.start, _compare_end: comparison.end }
              : {}),
            _limit: limit,
          })
          .order("impressions", { ascending: false })
          .order("normalized_query", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return out;
    },
  });
}

function useApiPageReport(
  organizationId: string | null,
  period: Period | null,
  comparison: Period | null,
  limit = 10000,
) {
  return useQuery({
    queryKey: [
      "gsc_api_page_report",
      organizationId,
      period?.start,
      period?.end,
      comparison?.start,
      comparison?.end,
      limit,
    ],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const out: unknown[] = [];
      for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .rpc("gsc_api_page_report", {
            _org_id: organizationId!,
            _start: period!.start,
            _end: period!.end,
            ...(comparison
              ? { _compare_start: comparison.start, _compare_end: comparison.end }
              : {}),
            _limit: limit,
          })
          .order("impressions", { ascending: false })
          .order("normalized_url", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return out;
    },
  });
}

/**
 * Query + page is its own Search Console grain. It is never reconstructed by
 * joining separately aggregated query and page rows.
 */
export function useApiQueryPageReport(
  organizationId: string | null,
  period: Period | null,
  communityId: string | null,
  limit = 2000,
) {
  return useQuery({
    queryKey: [
      "gsc_api_query_page_report",
      organizationId,
      period?.start,
      period?.end,
      communityId,
      limit,
    ],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_api_query_page_report", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        ...(communityId ? { _community_id: communityId } : {}),
        _limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useApiDimensionReport(
  organizationId: string | null,
  period: Period | null,
  dimension: "device" | "country" | "search_appearance",
) {
  return useQuery({
    queryKey: ["gsc_api_dimension_report", organizationId, period?.start, period?.end, dimension],
    enabled: !!organizationId && !!period,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gsc_api_dimension_report", {
        _org_id: organizationId!,
        _start: period!.start,
        _end: period!.end,
        _dimension: dimension,
        _limit: 500,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ------------------------------------------------ source aware read hooks */

type SourceResult<T> = {
  source: GscSource;
  coverage: ApiCoverage;
  data: T;
  isLoading: boolean;
};

/** Daily totals for the exact selected range. */
export function useSearchDailyTotals(organizationId: string | null, period: Period | null) {
  const cov = useGscApiCoverage(organizationId);
  const coverage = period
    ? coverageFor(cov.data, "date", period)
    : { extent: "none" as const, first: null, last: null };
  const useApi = coverage.extent !== "none";
  const api = useApiDailyTotals(organizationId, useApi ? period : null);
  const manual = useDailyTotals(organizationId, useApi ? null : period);
  return {
    source: (useApi ? "api" : "manual") as GscSource,
    coverage,
    data: (useApi ? api.data : manual.data) as
      | {
          clicks: number;
          impressions: number;
          ctr: number | null;
          avg_position: number | null;
          days: number;
          first_date: string | null;
          last_date: string | null;
        }
      | null
      | undefined,
    isLoading: cov.isLoading || (useApi ? api.isLoading : manual.isLoading),
  };
}

export function useSearchDailySeries(organizationId: string | null, period: Period | null) {
  const cov = useGscApiCoverage(organizationId);
  const coverage = period
    ? coverageFor(cov.data, "date", period)
    : { extent: "none" as const, first: null, last: null };
  const useApi = coverage.extent !== "none";
  const api = useApiDailySeries(organizationId, useApi ? period : null);
  const manual = useDailySeries(organizationId, useApi ? null : period);
  return {
    source: (useApi ? "api" : "manual") as GscSource,
    coverage,
    data: (useApi ? api.data : manual.data) ?? [],
    isLoading: cov.isLoading || (useApi ? api.isLoading : manual.isLoading),
  } as SourceResult<unknown[]>;
}

type ReportResult = SourceResult<unknown[]> & {
  /** Manual-import selection; only meaningful when source is "manual". */
  selection: ImportSelection;
  /** True when a like-for-like prior period is available. */
  comparable: boolean;
};

function useManualSelection(
  organizationId: string | null,
  grain: GrainKey,
  period: Period,
  overrideImportId: string | null,
) {
  const grains = useGrainImports(organizationId, grain);
  const selection = useMemo(
    () => selectImportForPeriod(grains.data ?? [], period, overrideImportId),
    [grains.data, period.start, period.end, overrideImportId],
  );
  return { grains, selection };
}

export function useSearchQueryReport(
  organizationId: string | null,
  period: Period,
  comparison: Period | null,
  overrideImportId: string | null = null,
): ReportResult {
  const cov = useGscApiCoverage(organizationId);
  const coverage = coverageFor(cov.data, "query", period);
  const useApi = coverage.extent !== "none" && !overrideImportId;
  const { grains, selection } = useManualSelection(
    organizationId,
    "query",
    period,
    overrideImportId,
  );
  const api = useApiQueryReport(organizationId, useApi ? period : null, useApi ? comparison : null);
  const manual = useQueryReport(
    organizationId,
    useApi ? null : (selection.current?.import_id ?? null),
    useApi ? null : (selection.comparison?.import_id ?? null),
  );
  return {
    source: useApi ? "api" : selection.current ? "manual" : "none",
    coverage,
    selection,
    comparable: useApi ? !!comparison : !!selection.comparison,
    data: (useApi ? api.data : manual.data) ?? [],
    isLoading: cov.isLoading || grains.isLoading || (useApi ? api.isLoading : manual.isLoading),
  };
}

export function useSearchPageReport(
  organizationId: string | null,
  period: Period,
  comparison: Period | null,
  overrideImportId: string | null = null,
): ReportResult {
  const cov = useGscApiCoverage(organizationId);
  const coverage = coverageFor(cov.data, "page", period);
  const useApi = coverage.extent !== "none" && !overrideImportId;
  const { grains, selection } = useManualSelection(
    organizationId,
    "page",
    period,
    overrideImportId,
  );
  const api = useApiPageReport(organizationId, useApi ? period : null, useApi ? comparison : null);
  const manual = usePageReport(
    organizationId,
    useApi ? null : (selection.current?.import_id ?? null),
    useApi ? null : (selection.comparison?.import_id ?? null),
  );
  return {
    source: useApi ? "api" : selection.current ? "manual" : "none",
    coverage,
    selection,
    comparable: useApi ? !!comparison : !!selection.comparison,
    data: (useApi ? api.data : manual.data) ?? [],
    isLoading: cov.isLoading || grains.isLoading || (useApi ? api.isLoading : manual.isLoading),
  };
}

export function useSearchDimensionReport(
  organizationId: string | null,
  period: Period,
  grain: "device" | "country" | "search_appearance",
  table: "gsc_device_facts" | "gsc_country_facts" | "gsc_search_appearance_facts",
  overrideImportId: string | null = null,
) {
  const cov = useGscApiCoverage(organizationId);
  const coverage = coverageFor(cov.data, grain, period);
  const useApi = coverage.extent !== "none" && !overrideImportId;
  const { grains, selection } = useManualSelection(organizationId, grain, period, overrideImportId);
  const api = useApiDimensionReport(organizationId, useApi ? period : null, grain);
  const manual = useSimpleGrain(
    table,
    grain,
    useApi ? null : (selection.current?.import_id ?? null),
  );

  const rows = useMemo(() => {
    if (useApi) {
      return ((api.data ?? []) as Record<string, unknown>[]).map((r) => ({
        label: String(r["dimension_value"] ?? "—"),
        clicks: Number(r["clicks"] ?? 0),
        impressions: Number(r["impressions"] ?? 0),
        ctr: r["ctr"] == null ? null : Number(r["ctr"]),
        position: r["position_value"] == null ? null : Number(r["position_value"]),
      }));
    }
    return ((manual.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      label: String(r[grain] ?? "—"),
      clicks: Number(r["clicks"] ?? 0),
      impressions: Number(r["impressions"] ?? 0),
      ctr: r["ctr"] == null ? null : Number(r["ctr"]),
      position: r["position"] == null ? null : Number(r["position"]),
    }));
  }, [useApi, api.data, manual.data, grain]);

  return {
    source: (useApi ? "api" : selection.current ? "manual" : "none") as GscSource,
    coverage,
    selection,
    rows,
    isLoading: cov.isLoading || grains.isLoading || (useApi ? api.isLoading : manual.isLoading),
  };
}
