import { format } from "date-fns";
import { EmptyState } from "@/components/clarity/empty-state";
import { cn } from "@/lib/utils";
import { useGoogleConnection } from "@/lib/google/queries";
import { useGa4Coverage, useGa4Health } from "@/lib/google/ga4-queries";

function Pill({ tone, label }: { tone: "positive" | "warning"; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "positive" ? "bg-success/10 text-success" : "bg-warning/15 text-warning",
      )}
    >
      {label}
    </span>
  );
}

function day(value: string | null | undefined) {
  return value ? format(new Date(`${value}T00:00:00`), "MMM d, yyyy") : "—";
}

function when(ts: string | null | undefined) {
  return ts ? format(new Date(ts), "MMM d, yyyy p") : "Never";
}

const REPORT_LABELS: Record<string, string> = {
  daily_totals: "Daily totals",
  source_medium: "Source / medium",
  source_medium_campaign: "Source / medium / campaign",
  channel_group: "Default channel group",
  landing_page: "Landing page",
  device: "Device",
};

/**
 * GA4 status for Data Health. Reports connection state, sync freshness, the
 * latest complete day, current partial-day status, rows stored per grain and
 * the last error. Grains are listed separately and never merged.
 */
export function Ga4HealthSection({ organizationId }: { organizationId: string | null }) {
  const connection = useGoogleConnection(organizationId, "ga4");
  const health = useGa4Health(organizationId);
  const coverage = useGa4Coverage(organizationId);
  const rows = coverage.data ?? [];
  const totalRows = rows.reduce((n, r) => n + Number(r.row_count ?? 0), 0);
  const h = health.data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">
        Google Analytics 4 (canonical for website traffic)
      </h2>
      {health.isLoading || coverage.isLoading ? (
        <div className="panel px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !rows.length ? (
        <EmptyState
          title="No GA4 data yet"
          description="Connect Google Analytics in Admin → Google Connections and run a sync. No other data source is affected until GA4 data exists."
        />
      ) : (
        <div className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill
              tone={connection.data?.status === "connected" ? "positive" : "warning"}
              label={connection.data?.status === "connected" ? "GA4 connected" : "Not connected"}
            />
            {h?.partial_date ? (
              <Pill tone="warning" label={`Partial day: ${day(h.partial_date)}`} />
            ) : null}
            {h?.missing_days ? (
              <Pill tone="warning" label={`${h.missing_days} missing days`} />
            ) : (
              <Pill tone="positive" label="No missing days" />
            )}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Last successful sync</dt>
              <dd className="text-foreground">{when(connection.data?.last_successful_sync_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Latest complete data date</dt>
              <dd className="text-foreground">{day(h?.last_complete_date)}</dd>
              <dd className="text-xs text-muted-foreground">
                Partial current-day rows are excluded from comparisons.
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">History stored</dt>
              <dd className="text-foreground">
                {day(h?.first_date)} – {day(h?.last_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rows stored</dt>
              <dd className="text-foreground">{totalRows.toLocaleString()}</dd>
              <dd className="text-xs text-muted-foreground">
                {Number(h?.mapped_landing_rows ?? 0).toLocaleString()} of{" "}
                {Number(h?.landing_rows ?? 0).toLocaleString()} landing rows mapped to a community
              </dd>
            </div>
          </dl>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <div key={r.report} className="rounded-md border border-border px-3 py-2">
                <p className="font-medium text-foreground">{REPORT_LABELS[r.report] ?? r.report}</p>
                <p>
                  {day(r.first_date)} – {day(r.last_date)}
                </p>
                <p>
                  {Number(r.row_count ?? 0).toLocaleString()} rows
                  {Number(r.partial_rows ?? 0) > 0
                    ? ` · ${Number(r.partial_rows).toLocaleString()} partial-day`
                    : ""}
                </p>
              </div>
            ))}
          </div>
          {connection.data?.last_error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Last error: {connection.data.last_error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No sync errors reported.</p>
          )}
        </div>
      )}
    </section>
  );
}
