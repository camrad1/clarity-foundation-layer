import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "warning" | "critical" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  critical: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

const STATUS_TONE: Record<string, Tone> = {
  connected: "positive",
  syncing: "info",
  manual_upload: "info",
  needs_attention: "warning",
  disconnected: "critical",
  active: "positive",
  inactive: "neutral",
  archived: "neutral",
  pending: "warning",
  draft: "neutral",
  provisional: "warning",
  validated: "positive",
  deprecated: "neutral",
  unvalidated: "neutral",
  in_review: "info",
  failed: "critical",
  matched: "positive",
  mismatch: "critical",
  approved: "positive",
  needs_review: "warning",
  success: "positive",
  partial: "warning",
  running: "info",
  skipped: "neutral",
  // The source system does not expose this dataset at all.
  unsupported: "neutral",

};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        TONE_CLASS[tone],
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
