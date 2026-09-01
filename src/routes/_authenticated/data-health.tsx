import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow, format } from "date-fns";
import { Database } from "lucide-react";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { useConnections, useSourceTypes, useSyncRuns } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/data-health")({
  head: () => ({
    meta: [
      { title: "Data Health — ClarityIQ" },
      {
        name: "description",
        content:
          "Connection status, sync freshness and import results for every ClarityIQ data source.",
      },
      { property: "og:title", content: "Data Health — ClarityIQ" },
      {
        property: "og:description",
        content: "Know exactly how fresh and how complete your performance data is.",
      },
    ],
  }),
  component: DataHealth,
});

function relative(ts: string | null) {
  if (!ts) return "Never";
  return `${formatDistanceToNow(new Date(ts))} ago`;
}

function DataHealth() {
  const { organizationId } = useAppState();
  const connections = useConnections(organizationId);
  const sourceTypes = useSourceTypes();
  const runs = useSyncRuns(organizationId);

  const typeName = (key: string) =>
    (sourceTypes.data ?? []).find((t) => t.key === key)?.name ?? key;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Data Health"
        description="Every source reports its own connection state, freshness and last import result. Nothing downstream should be trusted beyond what this page reports."
      />

      {connections.isLoading ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (connections.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No data sources connected"
          description="Add a connection in Admin → Data Sources. Search Console and Further can start as manual uploads; WelcomeHome can be registered as an API connection placeholder."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(connections.data ?? []).map((c) => {
            const latest = (runs.data ?? []).find((r) => r.connection_id === c.id);
            return (
              <article key={c.id} className="panel space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{typeName(c.source_type)}</p>
                    <h3 className="text-base font-semibold text-foreground">{c.display_name}</h3>
                  </div>
                  <StatusPill status={c.status} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Last successful sync</dt>
                    <dd className="text-foreground">{relative(c.last_successful_sync_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last attempted sync</dt>
                    <dd className="text-foreground">{relative(c.last_attempted_sync_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Data through</dt>
                    <dd className="text-foreground">
                      {c.data_through_date
                        ? format(new Date(`${c.data_through_date}T00:00:00`), "MMM d, yyyy")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latest run</dt>
                    <dd className="text-foreground">
                      {latest ? <StatusPill status={latest.status} /> : "No runs yet"}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  {latest ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Received {latest.records_received}</span>
                      <span>Inserted {latest.records_inserted}</span>
                      <span>Updated {latest.records_updated}</span>
                      <span
                        className={latest.records_failed > 0 ? "text-destructive" : undefined}
                      >
                        Failed {latest.records_failed}
                      </span>
                      {latest.error_summary ? (
                        <span className="w-full text-destructive">{latest.error_summary}</span>
                      ) : null}
                    </div>
                  ) : (
                    "No import has run for this connection yet."
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Coverage</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {["Marketing data coverage", "Sales funnel coverage", "Move-in attribution coverage"].map(
            (label) => (
              <article key={label} className="panel p-5">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Not yet measurable. Coverage is computed once source data is flowing; no
                  placeholder percentage is shown.
                </p>
              </article>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
