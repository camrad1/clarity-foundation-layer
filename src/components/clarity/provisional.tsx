import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CandidateValue } from "@/lib/wh/metrics";

/**
 * Presentation helpers for metrics whose official definition is not yet
 * validated. ClarityIQ never shows a polished number users could mistake for
 * an approved KPI.
 */

export function ProvisionalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning",
        className,
      )}
    >
      <AlertTriangle className="size-3" />
      Provisional
    </span>
  );
}

export function CandidateMetricCard({
  label,
  candidate,
  format = (n: number) => n.toLocaleString(),
  provisional = true,
  footnote,
}: {
  label: string;
  candidate: CandidateValue;
  format?: (n: number) => string;
  provisional?: boolean;
  footnote?: ReactNode;
}) {
  return (
    <div className="panel space-y-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {provisional && candidate.resolved ? <ProvisionalBadge /> : null}
      </div>
      {candidate.resolved ? (
        <p className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {format(candidate.value)}
        </p>
      ) : (
        <p className="font-display text-lg font-medium text-muted-foreground">Not configured</p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {candidate.resolved ? candidate.note : candidate.reason}
      </p>
      {footnote ? <div className="text-xs text-muted-foreground">{footnote}</div> : null}
    </div>
  );
}

export function WithheldPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel space-y-3 border-warning/40 p-5">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-warning" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
