import { useMemo } from "react";
import { useCommunities } from "@/lib/clarity-queries";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";
import {
  useWhActivities,
  useWhActivityMappings,
  useWhConnection,
  useWhContracts,
  useWhDeposits,
  useWhLookups,
  useWhProspects,
  useWhScoreMappings,
  useWhSettings,
  useWhTouchpoints,
  useWhUnits,
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
 */
export function useWhContext() {
  const { organizationId, dateRange, communityScope } = useAppState();
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

/** Loads every fact set a sales dashboard needs, scoped by RLS. */
export function useWhFacts(organizationId: string | null, communityIds: string[]) {
  const prospects = useWhProspects(organizationId, communityIds);
  const activities = useWhActivities(organizationId, communityIds);
  const contracts = useWhContracts(organizationId, communityIds);
  const deposits = useWhDeposits(organizationId, communityIds);
  const units = useWhUnits(organizationId, communityIds);
  const touchpoints = useWhTouchpoints(organizationId, communityIds);
  return {
    prospects: prospects.data ?? [],
    activities: activities.data ?? [],
    contracts: contracts.data ?? [],
    deposits: deposits.data ?? [],
    units: units.data ?? [],
    touchpoints: touchpoints.data ?? [],
    loading:
      prospects.isLoading ||
      activities.isLoading ||
      contracts.isLoading ||
      deposits.isLoading ||
      units.isLoading ||
      touchpoints.isLoading,
    empty:
      !prospects.isLoading &&
      !contracts.isLoading &&
      (prospects.data ?? []).length === 0 &&
      (contracts.data ?? []).length === 0,
  };
}

/** Label lookups for lead sources, users, stages, scores. */
export function useWhLabelMaps(connectionId: string | null) {
  const lookups = useWhLookups(connectionId);
  return useMemo(() => {
    const by: Record<string, Record<string, string>> = {};
    for (const l of (lookups.data ?? []) as any[]) {
      by[l.lookup_type] = by[l.lookup_type] ?? {};
      by[l.lookup_type]![l.source_id] = l.label ?? l.source_id;
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
