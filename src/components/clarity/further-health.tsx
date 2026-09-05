import { format, formatDistanceToNow } from "date-fns";
import { Link } from "@tanstack/react-router";
import { StatusPill } from "@/components/clarity/status-pill";
import { EmptyState } from "@/components/clarity/empty-state";
import {
  useFurtherConnection,
  useFurtherCounts,
  useFurtherFreshness,
  useFurtherMatchSummary,
  useFurtherSyncState,
} from "@/lib/further/queries";
import { FURTHER_DATASET_LABELS, type FurtherDataset } from "@/lib/further/tables";

function rel(ts: string | null | undefined) {
  if (!ts) return "Never";
  return `${formatDistanceToNow(new Date(ts))} ago`;
}

/**
 * Further source health for Data Health.
 *
 * Everything shown here is measured: freshness comes from the newest stored
 * record, coverage from confirmed mappings, and match coverage from active
 * deterministic evidence only.
 */
export function FurtherHealthSection({ organizationId }: { organizationId: string | null }) {
  const connection = useFurtherConnection(organizationId);
  const connectionId = connection.data?.id ?? null;
  const counts = useFurtherCounts(organizationId, connectionId);
  const freshness = useFurtherFreshness(organizationId);
  const syncState = useFurtherSyncState(connectionId);
  const matches = useFurtherMatchSummary(organizationId);

  if (!connection.isLoading && !connectionId) return null;

  const c = counts.data;
  const mappingCoverage = c
    ? `${c.mappedCommunities} of ${c.discoveredCommunities || "—"} mapped`
    : "—";
  const matchCoverage =
    c && c.leads > 0
      ? `${(matches.data?.active ?? 0).toLocaleString()} of ${c.leads.toLocaleString()} leads`
      : "No leads synced yet";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Further</h2>
        <Link to="/admin/further" className="text-xs text-primary hover:underline">
          Further Connection
        </Link>
      </div>

      {connection.isLoading ? (
        <div className="panel px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="panel space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Visitor, lead and conversation source</p>
              <h3 className="text-base font-semibold text-foreground">
                {connection.data?.display_name ?? "Further"}
              </h3>
            </div>
            <StatusPill status={connection.data?.status ?? "needs_attention"} />
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Last successful sync</dt>
              <dd className="text-foreground">{rel(connection.data?.last_successful_sync_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Leads freshness</dt>
              <dd className="text-foreground">
                {freshness.data?.leads
                  ? format(new Date(freshness.data.leads), "MMM d, yyyy h:mm a")
                  : "No leads"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Visitors freshness</dt>
              <dd className="text-foreground">
                {freshness.data?.visitors
                  ? format(new Date(freshness.data.visitors), "MMM d, yyyy h:mm a")
                  : "Unavailable"}
              </dd>
              <dd className="text-xs text-warning">
                Further's visitors endpoint is timing out and currently returns no usable data. It
                is excluded from the schedule; every other Further dataset is unaffected.
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Conversation freshness</dt>
              <dd className="text-foreground">
                {freshness.data?.events
                  ? format(new Date(freshness.data.events), "MMM d, yyyy h:mm a")
                  : "No events"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Community mapping coverage</dt>
              <dd className="text-foreground">{mappingCoverage}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">WelcomeHome match coverage</dt>
              <dd className="text-foreground">{matchCoverage}</dd>
              <dd className="text-xs text-muted-foreground">
                {matches.data?.field
                  ? `Exact-ID evidence via wh_prospects.${matches.data.field} — no fuzzy matching`
                  : "Identifier join not yet activated"}
              </dd>
            </div>
          </dl>

          {(syncState.data ?? []).length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium">Dataset</th>
                    <th className="py-2 text-left font-medium">Last success</th>
                    <th className="py-2 text-right font-medium">Received</th>
                    <th className="py-2 text-right font-medium">Failed</th>
                    <th className="py-2 text-right font-medium">Unmapped</th>
                  </tr>
                </thead>
                <tbody>
                  {((syncState.data ?? []) as any[]).map((s) => (
                    <tr key={s.dataset} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-foreground">
                        {FURTHER_DATASET_LABELS[s.dataset as FurtherDataset] ?? s.dataset}
                      </td>
                      <td className="py-2 text-muted-foreground">{rel(s.last_successful_at)}</td>
                      <td className="py-2 text-right text-foreground">{s.rows_received}</td>
                      <td
                        className={
                          s.rows_failed > 0 ? "py-2 text-right text-destructive" : "py-2 text-right"
                        }
                      >
                        {s.rows_failed}
                      </td>
                      <td className="py-2 text-right text-foreground">{s.rows_unmapped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Further has not synced yet"
              description="Store the Organization API Key and confirm community mappings in Admin → Further Connection."
            />
          )}
        </div>
      )}
    </section>
  );
}
