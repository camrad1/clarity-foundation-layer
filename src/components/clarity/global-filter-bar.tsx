import { Check, CalendarRange, Building2, GitCompareArrows } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAppState } from "@/state/app-state";
import { useCommunities, useRegions } from "@/lib/clarity-queries";
import {
  COMPARISON_PERIOD_MODES,
  DATE_RANGE_PRESET_GROUPS,
  formatPeriodLabel,
  formatRangeLabel,
  type ComparisonPeriodMode,
} from "@/lib/date-ranges";
import { cn } from "@/lib/utils";

/**
 * The single reusable ClarityIQ filter bar. Future dashboards read the same
 * state from `useAppState()` instead of rendering their own filters.
 */
export function GlobalFilterBar() {
  const {
    organizationId,
    dateRange,
    comparisonMode,
    comparisonRange,
    communityScope,
    setDatePreset,
    setCustomRange,
    setComparisonMode,
    setCommunityScope,
    toggleCommunity,
  } = useAppState();

  const communities = useCommunities(organizationId);
  const regions = useRegions(organizationId);
  const authorized = communities.data ?? [];

  const selectedCount =
    communityScope.mode === "communities"
      ? communityScope.communityIds.filter((id) => authorized.some((c) => c.id === id)).length
      : authorized.length;

  const communityLabel =
    communityScope.mode === "all"
      ? `All communities (${authorized.length})`
      : communityScope.mode === "region"
        ? (regions.data ?? []).find((r) => r.id === communityScope.regionId)?.name ?? "Region"
        : selectedCount === 1
          ? authorized.find((c) => c.id === (communityScope as { communityIds: string[] }).communityIds[0])?.name ??
            "1 community"
          : `${selectedCount} communities`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <CalendarRange className="size-4 text-muted-foreground" />
            {formatRangeLabel(dateRange)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="space-y-0.5">
            {DATE_RANGE_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setDatePreset(p.value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-muted",
                  dateRange.preset === p.value && "bg-muted font-medium",
                )}
              >
                {p.label}
                {dateRange.preset === p.value ? <Check className="size-4" /> : null}
              </button>
            ))}
          </div>
          {dateRange.preset === "custom" ? (
            <>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2 p-1">
                <div className="space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setCustomRange(e.target.value, dateRange.end)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setCustomRange(dateRange.start, e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : null}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <Building2 className="size-4 text-muted-foreground" />
            {communityLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <button
            type="button"
            onClick={() => setCommunityScope({ mode: "all" })}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-muted",
              communityScope.mode === "all" && "bg-muted font-medium",
            )}
          >
            All authorized communities
            {communityScope.mode === "all" ? <Check className="size-4" /> : null}
          </button>

          {(regions.data ?? []).length ? (
            <>
              <Separator className="my-2" />
              <p className="px-2.5 pb-1 eyebrow">Regions</p>
              {(regions.data ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setCommunityScope({ mode: "region", regionId: r.id })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-muted",
                    communityScope.mode === "region" &&
                      communityScope.regionId === r.id &&
                      "bg-muted font-medium",
                  )}
                >
                  {r.name}
                </button>
              ))}
            </>
          ) : null}

          <Separator className="my-2" />
          <p className="px-2.5 pb-1 eyebrow">Communities</p>
          <div className="max-h-64 overflow-y-auto">
            {authorized.length ? (
              authorized.map((c) => {
                const checked =
                  communityScope.mode === "communities" &&
                  communityScope.communityIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCommunity(c.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                      checked && "bg-muted font-medium",
                    )}
                  >
                    <span className="truncate">{c.name}</span>
                    {checked ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">
                No communities are authorized for your account yet.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
