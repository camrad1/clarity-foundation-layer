import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  normalizePreset,
  resolveComparisonPeriod,
  resolvePreset,
  type ComparisonPeriodMode,
  type DateRangePreset,
  type DateRangeValue,
  type Period,
} from "@/lib/date-ranges";

/**
 * Global ClarityIQ filter state.
 *
 * This is the single source of truth for organization scope, date range and
 * community selection. Every current and future dashboard must consume this
 * context rather than implementing its own filters.
 */

export type CommunityScope =
  | { mode: "all" }
  | { mode: "region"; regionId: string }
  | { mode: "communities"; communityIds: string[] };

type PersistedState = {
  organizationId: string | null;
  dateRange: DateRangeValue;
  communityScope: CommunityScope;
  comparisonMode: ComparisonPeriodMode;
};

type AppStateContextValue = PersistedState & {
  /** Resolved comparison window, or null when comparison is off. */
  comparisonRange: Period | null;
  setOrganizationId: (id: string | null) => void;
  setDatePreset: (preset: DateRangePreset) => void;
  setCustomRange: (start: string, end: string) => void;
  setComparisonMode: (mode: ComparisonPeriodMode) => void;
  setCommunityScope: (scope: CommunityScope) => void;
  toggleCommunity: (id: string) => void;
  hydrated: boolean;
};

const STORAGE_KEY = "clarityiq.filters.v1";

const defaultState: PersistedState = {
  organizationId: null,
  dateRange: resolvePreset("this_month"),
  communityScope: { mode: "all" },
  comparisonMode: "none",
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  // Restore persisted selections after hydration so filters survive navigation
  // and full page reloads between ClarityIQ sections.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        const preset = parsed.dateRange?.preset;
        setState({
          organizationId: parsed.organizationId ?? null,
          dateRange:
            preset && preset !== "custom"
              ? resolvePreset(normalizePreset(preset))
              : (parsed.dateRange ?? defaultState.dateRange),
          communityScope: parsed.communityScope ?? { mode: "all" },
          comparisonMode: parsed.comparisonMode ?? "none",
        });
      }
    } catch {
      /* ignore malformed local state */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state, hydrated]);

  const setOrganizationId = useCallback((organizationId: string | null) => {
    setState((s) =>
      s.organizationId === organizationId
        ? s
        : { ...s, organizationId, communityScope: { mode: "all" } },
    );
  }, []);

  const setDatePreset = useCallback((preset: DateRangePreset) => {
    setState((s) => ({
      ...s,
      dateRange:
        preset === "custom" ? { ...s.dateRange, preset: "custom" } : resolvePreset(preset),
    }));
  }, []);

  const setCustomRange = useCallback((start: string, end: string) => {
    setState((s) => ({ ...s, dateRange: { preset: "custom", start, end } }));
  }, []);

  const setComparisonMode = useCallback((comparisonMode: ComparisonPeriodMode) => {
    setState((s) => ({ ...s, comparisonMode }));
  }, []);

  const setCommunityScope = useCallback((communityScope: CommunityScope) => {
    setState((s) => ({ ...s, communityScope }));
  }, []);

  const toggleCommunity = useCallback((id: string) => {
    setState((s) => {
      const current = s.communityScope.mode === "communities" ? s.communityScope.communityIds : [];
      const next = current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id];
      return {
        ...s,
        communityScope: next.length ? { mode: "communities", communityIds: next } : { mode: "all" },
      };
    });
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      ...state,
      hydrated,
      setOrganizationId,
      setDatePreset,
      setCustomRange,
      setCommunityScope,
      toggleCommunity,
    }),
    [
      state,
      hydrated,
      setOrganizationId,
      setDatePreset,
      setCustomRange,
      setCommunityScope,
      toggleCommunity,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}

/**
 * Resolves the currently selected community ids against the list of
 * communities the signed-in user is authorized to see. Unauthorized ids can
 * never leak through because the authorized list itself comes from the
 * database under row level security.
 */
export function resolveSelectedCommunityIds(
  scope: CommunityScope,
  authorized: { id: string; region_id: string | null }[],
): string[] {
  if (scope.mode === "all") return authorized.map((c) => c.id);
  if (scope.mode === "region")
    return authorized.filter((c) => c.region_id === scope.regionId).map((c) => c.id);
  const allowed = new Set(authorized.map((c) => c.id));
  return scope.communityIds.filter((id) => allowed.has(id));
}
