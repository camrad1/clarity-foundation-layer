import { useMemo } from "react";
import { useCommunities } from "@/lib/clarity-queries";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import {
  useWhActivityMappings,
  useWhConnection,
  useWhLookups,
  useWhScoreMappings,
  useWhSettings,
} from "./queries";
import {
  buildActivityCategoryMap,
  buildScoreLevelMap,
  type ActivityCategoryMap,
  type CommunityTz,
  type ScoreLevelMap,
} from "./metrics";

/**
 * Shared WelcomeHome dashboard context: global filters resolved against the
 * communities the signed-in user is authorized to see, plus the semantic
 * mappings every provisional metric depends on.
 *
 * Fact rows are never loaded here. Aggregates come from the database through
 * ./summary.ts so KPI accuracy does not depend on a browser row limit.
 */
export function useWhContext() {
  const { organizationId, dateRange, comparisonMode, comparisonRange, communityScope } = useAppState();
  const communities = useCommunities(organizationId);
  const connection = useWhConnection(organizationId);
  const connectionId = connection.data?.id ?? null;

  const authorized = useMemo(
    () =>
      (communities.data ?? []).map((c: any) => ({
        id: c.id as string,
        region_id: (c.region_id as string | null) ?? null,
      })),
    [communities.data],
  );

  const communityIds = useMemo(
    () => resolveSelectedCommunityIds(communityScope, authorized),
    [communityScope, authorized],
  );

  const tz = useMemo<CommunityTz>(() => {
    const map: CommunityTz = {};
    for (const c of communities.data ?? []) map[(c as any).id] = (c as any).timezone ?? null;
    return map;
  }, [communities.data]);

  const communityNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of communities.data ?? []) map[(c as any).id] = (c as any).name;
    return map;
  }, [communities.data]);

  const settings = useWhSettings(organizationId);
  const activityMappings = useWhActivityMappings(connectionId);
  const scoreMappings = useWhScoreMappings(connectionId);

  const activityMap = useMemo<ActivityCategoryMap>(
    () => buildActivityCategoryMap((activityMappings.data ?? []) as any),
    [activityMappings.data],
  );
  const scoreMap = useMemo<ScoreLevelMap>(
    () => buildScoreLevelMap((scoreMappings.data ?? []) as any),
    [scoreMappings.data],
  );

  return {
    organizationId,
    connection: connection.data ?? null,
    connectionId,
    dateRange,
    comparisonMode,
    comparisonRange,
    communityIds,
    communityNames,
    tz,
    settings: settings.data ?? null,
    activityMap,
    scoreMap,
    loading:
      communities.isLoading ||
      connection.isLoading ||
      settings.isLoading ||
      activityMappings.isLoading ||
      scoreMappings.isLoading,
  };
}

/** Label lookups for lead sources, users, stages, scores, care types. */
const LABEL_LOOKUP_TYPES = ["lead_source", "user", "stage", "score", "care_type"];

export function useWhLabelMaps(connectionId: string | null) {
  const lookups = useWhLookups(connectionId, LABEL_LOOKUP_TYPES);
  return useMemo(() => {
    const by: Record<string, Record<string, string>> = {};
    for (const l of (lookups.data ?? []) as any[]) {
      const label = typeof l.label === "string" ? l.label.trim() : "";
      if (!label) continue; // never fall back to the raw source id as a label
      by[l.lookup_type] = by[l.lookup_type] ?? {};
      by[l.lookup_type]![l.source_id] = label;
    }
    return {
      leadSource: by["lead_source"] ?? {},
      user: by["user"] ?? {},
      stage: by["stage"] ?? {},
      score: by["score"] ?? {},
      careType: by["care_type"] ?? {},
      loading: lookups.isLoading,
    };
  }, [lookups.data, lookups.isLoading]);
}

/**
 * Resolve a source id to its WelcomeHome label. Unresolved ids never surface as
 * raw numbers in the UI; they collapse to a neutral fallback and the id stays
 * available for admin diagnostics (Data Health → lookup coverage).
 */
export function resolveLabel(
  map: Record<string, string>,
  id: string | null | undefined,
  fallback = "Unknown",
): string {
  const key = (id ?? "").trim();
  if (!key) return fallback;
  return map[key] ?? fallback;
}

