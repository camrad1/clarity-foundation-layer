import { DataTable } from "@/components/clarity/data-table";
import { useWhLookupCoverage } from "@/lib/wh/queries";
import { useWhContext } from "@/lib/wh/use-wh";

const TYPE_LABELS: Record<string, string> = {
  lead_source: "Lead sources",
  stage: "Pipeline stages",
  user: "Counselors / users",
};

/**
 * Referential coverage of WelcomeHome label lookups.
 *
 * Compares the distinct dimension ids referenced by normalized fact rows
 * against the labels stored in wh_lookups, so unresolved ids surface here
 * instead of leaking into dashboards as raw numbers. The comparison runs
 * server-side (wh_lookup_coverage) and is tenant/community authorized — no
 * fact rows are downloaded to the browser.
 */
export function WhLookupCoveragePanel() {
  const ctx = useWhContext();
  const coverage = useWhLookupCoverage(ctx.organizationId, ctx.communityIds);
  const rows = coverage.data ?? [];

  if (!ctx.connection) return null;

  const unresolvedTotal = rows.reduce((a, r) => a + Number(r.unresolved || 0), 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">WelcomeHome label coverage</h2>
        <p className="text-xs text-muted-foreground">
          Every lead source, stage and counselor id referenced by stored records is checked against
          the synced WelcomeHome lookup labels for this selection.{" "}
          {coverage.isLoading
            ? "Checking…"
            : unresolvedTotal === 0
              ? "All referenced ids resolve to a readable label."
              : `${unresolvedTotal} referenced id(s) have no label yet — resync the matching lookup table from WelcomeHome Connection → Tables.`}
        </p>
      </div>
      <DataTable
        columns={[
          {
            key: "t",
            header: "Dimension",
            render: (r: any) => TYPE_LABELS[r.lookup_type] ?? r.lookup_type,
          },
          {
            key: "ref",
            header: "Referenced ids",
            align: "right",
            render: (r: any) => Number(r.referenced).toLocaleString(),
          },
          {
            key: "res",
            header: "Resolved",
            align: "right",
            render: (r: any) => Number(r.resolved).toLocaleString(),
          },
          {
            key: "unres",
            header: "Unresolved",
            align: "right",
            render: (r: any) => (
              <span className={Number(r.unresolved) > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                {Number(r.unresolved).toLocaleString()}
              </span>
            ),
          },
          {
            key: "ids",
            header: "Unresolved source ids",
            render: (r: any) =>
              (r.unresolved_ids ?? []).length
                ? (r.unresolved_ids as string[]).slice(0, 12).join(", ") +
                  ((r.unresolved_ids as string[]).length > 12 ? " …" : "")
                : "—",
          },
        ]}
        rows={rows as any[]}
        loading={coverage.isLoading}
        empty="No WelcomeHome records in the current selection."
      />
    </section>
  );
}
