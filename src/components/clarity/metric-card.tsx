import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  delta,
  footnote,
}: {
  label: string;
  value: ReactNode;
  /** Relative change vs the comparison period, or null when unavailable. */
  delta?: { label: string; tone: "up" | "down" | "neutral" } | null;
  footnote?: ReactNode;
}) {
  const Icon = delta?.tone === "up" ? ArrowUpRight : delta?.tone === "down" ? ArrowDownRight : Minus;
  return (
    <div className="kpi-card space-y-2 p-5">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight text-brand">{value}</p>
      <div className="flex items-center gap-2 text-xs">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              delta.tone === "up" && "text-success",
              delta.tone === "down" && "text-destructive",
              delta.tone === "neutral" && "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {delta.label}
          </span>
        ) : (
          <span className="text-muted-foreground">No comparison</span>
        )}
        {footnote ? <span className="text-muted-foreground">{footnote}</span> : null}
      </div>
    </div>
  );
}
