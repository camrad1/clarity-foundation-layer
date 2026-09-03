import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Chart series visibility.
 *
 * Presentation-only state, persisted for the current browser session under a
 * chart-specific key so different charts keep independent selections. At least
 * one series always stays active, and toggling never triggers a network
 * request: the aggregate for the whole window is already in the cache.
 *
 * Series keys may arrive asynchronously (reason and lead-source categories come
 * from the server aggregate), so the stored selection is intersected with the
 * currently available keys on every render rather than frozen at mount.
 */
export function useSeriesVisibility(
  storageKey: string,
  allKeys: string[],
  defaultKeys: string[],
) {
  const [stored, setStored] = useState<string[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((k): k is string => typeof k === "string");
    } catch {
      return null;
    }
  });

  const allSig = allKeys.join("|");
  const defSig = defaultKeys.join("|");

  const visible = useMemo(() => {
    const base = stored ?? defaultKeys;
    const clean = base.filter((k) => allKeys.includes(k));
    if (clean.length) return clean;
    const fallback = defaultKeys.filter((k) => allKeys.includes(k));
    return fallback.length ? fallback : allKeys.slice(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, allSig, defSig]);

  const toggle = (key: string) => {
    const isOn = visible.includes(key);
    if (isOn && visible.length === 1) return; // never hide the last series
    const next = isOn ? visible.filter((k) => k !== key) : [...visible, key];
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* session storage unavailable; keep in-memory state */
    }
    setStored(next);
  };

  return { visible, toggle };
}

/** Compact pill toggles for chart series. Chips wrap naturally on narrow screens. */
export function SeriesToggleChips({
  series,
  visible,
  onToggle,
}: {
  series: { key: string; label: string; color: string; provisional?: boolean }[];
  visible: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Toggle chart series">
      {series.map((s) => {
        const active = visible.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(s.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "border-border bg-muted text-foreground"
                : "border-transparent bg-transparent text-muted-foreground/60 hover:text-muted-foreground",
            )}
          >
            <span
              className={cn("size-2 rounded-full", !active && "opacity-40")}
              style={{ background: s.color }}
            />
            {s.label}
            {s.provisional ? (
              <span className="rounded-full bg-warning/15 px-1 text-[9px] font-semibold uppercase text-warning">
                Provisional
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
