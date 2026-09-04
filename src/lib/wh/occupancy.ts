import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFlashBudgets, type FlashBudgetRow } from "@/lib/flash/queries";

/**
 * CANONICAL CURRENT OCCUPANCY (single source of truth).
 *
 * Everything — Sales Intelligence, Occupancy Intelligence, the Flash Report and
 * the Data Health reconciliation panel — reads occupancy from the database
 * function `wh_current_occupancy`, so the same numbers appear everywhere.
 *
 * Definition (derived from real WelcomeHome evidence, no community overrides):
 *   denominator = Unit records minus deterministic exclusions
 *                 (off-census, inactive/discarded, configured pseudo-units)
 *   numerator   = census-eligible units whose housing contract state is
 *                 `current` or `notice` (contract financial status), counted
 *                 once per unit — NOT per resident and NOT from move-in event
 *                 flags, which also count canceled contracts.
 *
 * This is current state only. Historical as-of-date occupancy needs the nightly
 * snapshot system, which is deliberately not built yet.
 */
export type CapacityBasis = "rooms" | "occupancy_points" | "configured_capacity";

export const CAPACITY_BASIS_LABELS: Record<CapacityBasis, string> = {
  rooms: "Physical rooms",
  occupancy_points: "Occupancy points",
  configured_capacity: "Configured capacity",
};

export type CommunityOccupancy = {
  id: string;
  name: string;
  capacity_basis: CapacityBasis;
  configured_units: number | null;
  total_unit_records: number;
  excluded_units: number;
  off_census_units: number;
  pseudo_units: number;
  inactive_units: number;
  /** Physical apartments/rooms eligible for census. */
  census_rooms: number;
  /** Occupancy-point capacity of those rooms (shared suites count > 1). */
  census_capacity: number;
  configured_capacity: number | null;
  occupied_rooms: number;
  occupied_capacity: number;
  /** Canonical denominator selected by the community's capacity basis. */
  census_units: number;
  /** Canonical numerator selected by the community's capacity basis. */
  occupied_units: number;
  vacant_units: number;
  notice_units: number;
  reserved_units: number;
  pending_move_ins: number;
  occupancy_pct: number | null;
  unit_count_discrepancy: boolean;
  by_care_type: { careType: string; units: number; occupied: number; rooms?: number; capacity?: number }[];
};

export type CurrentOccupancy = {
  asOf: string;
  basis: string;
  communities: CommunityOccupancy[];
  totals: {
    totalUnitRecords: number;
    excludedUnits: number;
    offCensusUnits: number;
    pseudoUnits: number;
    inactiveUnits: number;
    censusRooms: number;
    censusCapacity: number;
    occupiedRooms: number;
    occupiedCapacity: number;
    censusUnits: number;
    occupiedUnits: number;
    vacantUnits: number;
    noticeUnits: number;
    reservedUnits: number;
    pendingMoveIns: number;
    configuredUnits: number | null;
    occupancyPct: number | null;
  };
};


export function useCurrentOccupancy(organizationId: string | null, communityIds: string[]) {
  return useQuery({
    queryKey: ["wh_current_occupancy", organizationId, communityIds.join(",")],
    enabled: !!organizationId,
    queryFn: async (): Promise<CurrentOccupancy> => {
      const { data, error } = await (supabase as any).rpc("wh_current_occupancy", {
        _org_id: organizationId,
        _community_ids: communityIds.length ? communityIds : null,
      });
      if (error) throw error;
      return data as CurrentOccupancy;
    },
  });
}

/** The budget row in force for a community on a given date (default today). */
export function effectiveBudget(
  rows: FlashBudgetRow[],
  communityId: string,
  onDate = new Date().toISOString().slice(0, 10),
): FlashBudgetRow | null {
  return (
    rows
      .filter(
        (r) =>
          r.community_id === communityId &&
          r.effective_start <= onDate &&
          (!r.effective_end || r.effective_end >= onDate),
      )
      .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1))[0] ?? null
  );
}

export type BudgetResolution = {
  /** Budgeted occupied units, either stored directly or derived from the budget %. */
  units: number | null;
  /** Budgeted occupancy %, either stored directly or derived from budgeted units. */
  pct: number | null;
  /** Actual − budget, in occupied units. */
  varianceUnits: number | null;
  /** Actual − budget, in percentage points. */
  variancePoints: number | null;
};

/**
 * Budgeted occupied units are the canonical stored input (the legacy Flash
 * model); the percentage is derived against the census denominator. A stored
 * percentage is honoured when no unit budget exists.
 */
export function resolveBudget(
  row: FlashBudgetRow | null,
  censusUnits: number,
  occupiedUnits: number,
): BudgetResolution {
  if (!row || !censusUnits) return { units: null, pct: null, varianceUnits: null, variancePoints: null };
  const storedPct = row.budget_occupancy_pct == null ? null : Number(row.budget_occupancy_pct);
  const units =
    row.budget_occupied_units != null
      ? Number(row.budget_occupied_units)
      : storedPct != null
        ? Math.round(storedPct * censusUnits)
        : null;
  const pct = units != null ? units / censusUnits : storedPct;
  const actualPct = occupiedUnits / censusUnits;
  return {
    units,
    pct,
    varianceUnits: units == null ? null : occupiedUnits - units,
    variancePoints: pct == null ? null : (actualPct - pct) * 100,
  };
}

/** Convenience: canonical occupancy plus the org's budget rows. */
export function useOccupancyWithBudget(organizationId: string | null, communityIds: string[]) {
  const occupancy = useCurrentOccupancy(organizationId, communityIds);
  const budgets = useFlashBudgets(organizationId);
  return { occupancy, budgets, budgetRows: budgets.data ?? [] };
}
