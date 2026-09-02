import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { CandidateMetricCard, ProvisionalBadge, WithheldPanel } from "@/components/clarity/provisional";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ratio } from "@/lib/wh/metrics";
import {
  candidate,
  useWhDepositPage,
  useWhTourPage,
  useWhProspectPage,
  useWhSalesSummary,
  withheld,
  type WhProspectBucket,
} from "@/lib/wh/summary";

import { useWhContext, useWhLabelMaps } from "@/lib/wh/use-wh";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "Sales Intelligence — ClarityIQ" },
      {
        name: "description",
        content:
          "Inquiry, tour, deposit and move-in performance calculated deterministically from WelcomeHome CRM records.",
      },
      { property: "og:title", content: "Sales Intelligence — ClarityIQ" },
      {
        property: "og:description",
        content: "Funnel, pipeline health, counselor activity and occupancy components from CRM data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesIntelligence,
});

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/**
 * Sales Intelligence.
 *
 * Every figure on this page is produced by the database function
 * public.wh_sales_summary over the complete normalized WelcomeHome dataset,
 * filtered by organization authorization, the selected communities and the
 * selected date range before aggregation. The browser receives counts, not
 * records, so accuracy is identical at 2,000 or 500,000 source rows.
 *
 * Record-level lists are paginated server-side through wh_prospect_page.
 */
function SalesIntelligence() {
  const ctx = useWhContext();
  const labels = useWhLabelMaps(ctx.connectionId);
  const summary = useWhSalesSummary(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
  );
  const [tab, setTab] = useState("funnel");

  if (!ctx.connection) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="WelcomeHome is not connected"
          description="Connect WelcomeHome in Admin → WelcomeHome Connection, map your communities, then run a sync."
        />
      </div>
    );
  }

  if (ctx.loading || summary.isLoading) {
    return <div className="panel px-6 py-16 text-center text-sm text-muted-foreground">Loading CRM data…</div>;
  }

  if (summary.error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="Sales metrics could not be calculated"
          description={(summary.error as Error).message}
        />
      </div>
    );
  }

  const s = summary.data;

  if (!s || s.exclusions.total === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Sales Intelligence" description="CRM-sourced sales performance." />
        <EmptyState
          title="No WelcomeHome records for this selection"
          description="Either no sync has completed yet, or the selected communities have no mapped WelcomeHome community. Nothing is estimated to fill the gap."
        />
      </div>
    );
  }

  const inquiries = candidate(s.inquiries, `Provisional: ${s.settings.inquiry_date_field}, community-local date.`);
  const tours = s.mappings.tour
    ? candidate(
        s.tours,
        `Provisional V-002: tour activities completed in the period whose WelcomeHome activity result is flagged successful. ${s.tourRecon.totalTourActivities} total tour activities, ${s.tourRecon.unsuccessfulTours} unsuccessful.`,
      )
    : withheld("No WelcomeHome activity type is mapped to Tour yet.");
  const reTours = s.mappings.tour
    ? candidate(
        s.tourRecon.repeatTours,
        "Provisional V-002: successful tours that are not the prospect's first completed tour (WelcomeHome first_completed_of_activity_type = false).",
      )
    : withheld("Requires an activity type mapped to Tour.");
  const deposits = candidate(
    s.deposits,
    "Provisional V-003: transaction_type = Deposit and deposit_type = Deposit. Refunds, waitlist deposits and other deposit types are excluded.",
  );

  const moveIns = candidate(s.moveIns, `Provisional: count_move_in with ${s.settings.move_in_date_field}.`);
  const moveOuts = candidate(s.moveOuts, `Provisional: count_move_out with ${s.settings.move_out_date_field}.`);
  const net = candidate(s.moveIns - s.moveOuts, "Move-ins minus move-outs for the selected period.");
  const hot = s.mappings.hot
    ? candidate(s.hot, "Open prospects whose score is mapped to Hot.")
    : withheld("No WelcomeHome score is mapped to Hot yet.");
  const hotNoActivity = s.mappings.hot
    ? candidate(s.hotNoActivity, `Hot prospects with no future scheduled activity (${s.settings.hot_no_activity_mode}).`)
    : withheld("Requires a score mapped to Hot.");
  const stalled = candidate(
    s.stalled,
    `Open prospects with no contact for ${s.settings.stalled_threshold_days}+ days.`,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Sales Intelligence"
        description="Every number below is a database count of WelcomeHome records over the full normalized dataset, converted to community-local dates. Definitions still awaiting reconciliation are labelled provisional; unresolvable ones are withheld rather than guessed."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline health</TabsTrigger>
          <TabsTrigger value="counselors">Counselors</TabsTrigger>
          <TabsTrigger value="sources">Lead sources</TabsTrigger>
          <TabsTrigger value="occupancy">Occupancy components</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="space-y-6 pt-6">
          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <CandidateMetricCard label="New inquiries" candidate={inquiries} />
            <CandidateMetricCard label="Completed tours" candidate={tours} />
            <CandidateMetricCard label="Re-tours" candidate={reTours} />
            <CandidateMetricCard label="Deposits" candidate={deposits} />
            <CandidateMetricCard label="Move-ins" candidate={moveIns} />
            <CandidateMetricCard label="Move-outs" candidate={moveOuts} />
            <CandidateMetricCard label="Net move-ins" candidate={net} />
            <div className="panel space-y-1 p-5">
              <p className="eyebrow">Pending move-ins / outs</p>
              <p className="font-display text-2xl font-semibold">
                {s.pending.pendingIn} / {s.pending.pendingOut}
              </p>
              <p className="text-xs text-muted-foreground">Future-dated contracts, current state.</p>
            </div>
          </section>

          <section className="panel space-y-3 p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Cohort conversion</h2>
              <ProvisionalBadge />
            </div>
            <p className="text-sm text-muted-foreground">
              Leads created in this period and what they have done since — not period-over-period
              division of unrelated events. Period-event totals appear above; they are different
              questions and are never blended.
            </p>
            <div className="grid gap-4 md:grid-cols-4">
              <Stat label="Cohort size" value={s.cohort.cohortSize} />
              <Stat
                label="Toured"
                value={s.cohort.toured ?? "—"}
                sub={pct(ratio(s.cohort.toured, s.cohort.cohortSize))}
              />
              <Stat
                label="Deposited"
                value={s.cohort.deposited}
                sub={pct(ratio(s.cohort.deposited, s.cohort.cohortSize))}
              />
              <Stat
                label="Moved in"
                value={s.cohort.movedIn}
                sub={pct(ratio(s.cohort.movedIn, s.cohort.cohortSize))}
              />
            </div>
            {s.cohort.linkageCoverage != null && s.cohort.linkageCoverage < 0.95 ? (
              <p className="text-xs text-warning">
                Only {pct(s.cohort.linkageCoverage)} of activities carry a prospect link, so
                tour-level conversion understates reality. Treat it as a floor, not a rate.
              </p>
            ) : null}
            {s.cohort.toured == null ? (
              <p className="text-xs text-muted-foreground">
                Tour conversion is withheld until an activity type is mapped to Tour.
              </p>
            ) : null}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel space-y-2 p-5">
              <h3 className="text-sm font-semibold">Prospect exclusions</h3>
              <p className="text-xs text-muted-foreground">
                Counted in the database across every stored record. Excluded rows are retained for
                audit, never deleted.
              </p>
              <ul className="text-sm text-muted-foreground">
                <li>Total prospects stored: {s.exclusions.total.toLocaleString()}</li>
                <li>Merged duplicates excluded: {s.exclusions.merged.toLocaleString()}</li>
                <li>Discarded excluded: {s.exclusions.discarded.toLocaleString()}</li>
                <li className="text-foreground">Countable: {s.exclusions.countable.toLocaleString()}</li>
              </ul>
            </div>
            <div className="panel space-y-2 p-5">
              <h3 className="text-sm font-semibold">Tour reconciliation</h3>
              <p className="text-xs text-muted-foreground">
                Candidate (V-002, provisional): tour activities completed in the period whose
                WelcomeHome activity result is flagged successful.
              </p>
              <ul className="text-sm text-muted-foreground">
                <li className="text-foreground">Successful tours (KPI): {s.tourRecon.successfulTours}</li>
                <li>Initial tours: {s.tourRecon.initialTours}</li>
                <li>Repeat tours: {s.tourRecon.repeatTours}</li>
              </ul>
              <p className="eyebrow pt-2">Diagnostic components — not KPI values</p>
              <ul className="text-xs text-muted-foreground">
                <li>Total tour activities: {s.tourRecon.totalTourActivities}</li>
                <li>Unsuccessful / excluded: {s.tourRecon.unsuccessfulTours}</li>
                {s.tourRecon.byResult.map((r) => (
                  <li key={r.result}>
                    {r.result}: {r.n} ({r.successful ? "successful" : "not successful"})
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel space-y-2 p-5">
              <h3 className="text-sm font-semibold">Deposit source comparison</h3>
              <p className="text-xs text-muted-foreground">
                Candidate (V-003, provisional): transaction_type = Deposit AND deposit_type =
                Deposit, dated in the selected period.
              </p>
              <ul className="text-sm text-muted-foreground">
                <li>Standard DepositTransactions: {s.depositRecon.fromTransactions}</li>
                <li>HousingContract deposit fields: {s.depositRecon.fromContracts}</li>
              </ul>
              <p className="eyebrow pt-2">Diagnostic components — not KPI values</p>
              <ul className="text-xs text-muted-foreground">
                <li>Refund transactions: {s.depositRecon.refunds}</li>
                <li>Waitlist Deposit transactions: {s.depositRecon.waitlist}</li>
                <li>Other deposit types: {s.depositRecon.otherTypes}</li>
              </ul>
              {s.depositRecon.fromTransactions !== s.depositRecon.fromContracts ? (
                <p className="text-xs text-warning">
                  The two sources disagree. Resolve V-003 before treating deposits as validated.
                </p>
              ) : null}
            </div>

          </section>

          <TourDrillThrough />

          <DepositDrillThrough />
        </TabsContent>


        <TabsContent value="pipeline" className="space-y-6 pt-6">
          <section className="grid gap-4 md:grid-cols-4">
            <Stat label="Open pipeline" value={s.pipeline} sub="Current state" />
            <CandidateMetricCard label="Hot leads" candidate={hot} />
            <CandidateMetricCard label="Hot, no future activity" candidate={hotNoActivity} />
            <CandidateMetricCard label="Stalled prospects" candidate={stalled} />
          </section>

          <ProspectDrillThrough />

          <WithheldPanel
            title="Stage distribution over time is not available"
            description="Historical stage distribution requires WelcomeHome Daily Snapshots. Only current stage state is stored today, so a trend line would be a reconstruction rather than a measurement."
          >
            <DataTable
              columns={[
                { key: "stage", header: "Current stage", render: (r: any) => labels.stage[r.id] ?? r.id },
                { key: "n", header: "Open prospects", align: "right", render: (r: any) => r.n },
              ]}
              rows={s.stageDistribution as any[]}
              empty={<EmptyState title="No open prospects" />}
            />
          </WithheldPanel>
        </TabsContent>

        <TabsContent value="counselors" className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">
            Activity attribution uses the owning user recorded on each WelcomeHome activity and the
            sales counselor recorded on each contract. Unassigned records are not redistributed.
          </p>
          <DataTable
            columns={[
              { key: "user", header: "Counselor", render: (r: any) => labels.user[r.id] ?? r.id },
              { key: "act", header: "Activities", align: "right", render: (r: any) => r.activities },
              { key: "tours", header: "Tours", align: "right", render: (r: any) => r.tours },
              { key: "mi", header: "Move-ins", align: "right", render: (r: any) => r.moveIns },
              { key: "pipe", header: "Open pipeline", align: "right", render: (r: any) => r.pipeline },
            ]}
            rows={s.counselors as any[]}
            empty={<EmptyState title="No counselor activity in this period" />}
          />
        </TabsContent>

        <TabsContent value="sources" className="space-y-4 pt-6">
          <DataTable
            columns={[
              { key: "src", header: "Lead source", render: (r: any) => labels.leadSource[r.id] ?? r.id },
              { key: "inq", header: "Inquiries", align: "right", render: (r: any) => r.inquiries },
              { key: "mi", header: "Move-ins", align: "right", render: (r: any) => r.moveIns },
            ]}
            rows={s.leadSources as any[]}
            empty={<EmptyState title="No lead source data" />}
          />
          <div className="panel space-y-2 p-5">
            <h3 className="text-sm font-semibold">Digital metadata coverage</h3>
            <p className="text-xs text-muted-foreground">
              How often UTM values arrive on prospect records. Cross-source attribution is a later
              phase; this is a readiness measurement only.
            </p>
            <ul className="text-sm text-muted-foreground">
              {Object.entries(s.utm.counts).map(([k, v]) => (
                <li key={k}>
                  {k}: {v} of {s.utm.total} ({pct(ratio(Number(v), s.utm.total))})
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="occupancy" className="space-y-6 pt-6">
          <WithheldPanel
            title="Occupancy percentage is withheld"
            description="ClarityIQ will not publish an occupancy KPI until the candidate calculation is reconciled against official operational census (V-005). The raw source components are shown so you can audit them."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Stat label="Total units" value={s.occupancy.totalUnits} />
              <Stat label="Off-census units" value={s.occupancy.offCensusUnits} />
              <Stat label="Census units" value={s.occupancy.censusUnits} />
              <Stat label="Occupied (candidate)" value={s.occupancy.occupiedUnitsCandidate} />
              <Stat label="On notice" value={s.occupancy.noticeCount} />
              <Stat label="Pending move-ins" value={s.occupancy.pendingMoveIns} />
            </div>
            <p className="pt-3 text-xs text-muted-foreground">
              Candidate ratio, shown for reconciliation only:{" "}
              {pct(ratio(s.occupancy.occupiedUnitsCandidate, s.occupancy.censusUnits))}
            </p>
          </WithheldPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const BUCKETS: { value: WhProspectBucket; label: string }[] = [
  { value: "overdue", label: "Overdue next activity" },
  { value: "pipeline", label: "Open pipeline" },
  { value: "hot", label: "Hot leads" },
  { value: "hot_no_activity", label: "Hot, no future activity" },
  { value: "stalled", label: "Stalled" },
];

const PAGE_SIZE = 50;

/** Server-paginated record list. The full table is never sent to the browser. */
function ProspectDrillThrough() {
  const ctx = useWhContext();
  const labels = useWhLabelMaps(ctx.connectionId);
  const [bucket, setBucket] = useState<WhProspectBucket>("overdue");
  const [page, setPage] = useState(0);
  const q = useWhProspectPage(ctx.organizationId, bucket, ctx.communityIds, page, PAGE_SIZE);

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <Button
            key={b.value}
            size="sm"
            variant={bucket === b.value ? "default" : "outline"}
            onClick={() => {
              setBucket(b.value);
              setPage(0);
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>
      <DataTable
        columns={[
          { key: "src", header: "Prospect", render: (p: any) => <code className="text-xs">{p.source_id}</code> },
          { key: "com", header: "Community", render: (p: any) => ctx.communityNames[p.community_id ?? ""] ?? "—" },
          { key: "stage", header: "Stage", render: (p: any) => labels.stage[p.stage_id ?? ""] ?? "—" },
          { key: "score", header: "Score", render: (p: any) => labels.score[p.score_id ?? ""] ?? "—" },
          {
            key: "next",
            header: "Scheduled",
            render: (p: any) => <span className="text-xs">{p.next_activity_scheduled_at?.slice(0, 10) ?? "—"}</span>,
          },
          {
            key: "counselor",
            header: "Counselor",
            render: (p: any) => labels.user[p.current_sales_counselor_id ?? ""] ?? "—",
          },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No matching prospects" description="Nothing in this bucket for the current selection." />}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} matching {total === 1 ? "prospect" : "prospects"} · page {page + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Deposit KPI drill-through. Server-paginated through wh_deposit_page, which
 * applies the same V-003 filter as the KPI, so this list always reconciles to
 * the displayed Deposit count. No resident or prospect PII is returned.
 */
/**
 * Tour KPI drill-through (V-002). Server-paginated through wh_tour_page: the
 * default view lists exactly the successful tours behind the KPI, and the
 * diagnostic view lists every tour activity in the period. No prospect PII.
 */
function TourDrillThrough() {
  const ctx = useWhContext();
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"successful" | "all">("successful");
  const q = useWhTourPage(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
    mode,
    page,
    PAGE_SIZE,
  );
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {mode === "successful" ? "Counted tour activities" : "All tour activities (diagnostic)"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {mode === "successful"
              ? "Exactly the rows behind the Completed tours candidate: tour activities with a successful WelcomeHome result, completed in the selected period."
              : "Every completed tour activity in the period, including results WelcomeHome does not treat as successful."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMode((m) => (m === "successful" ? "all" : "successful"));
            setPage(0);
          }}
        >
          {mode === "successful" ? "Show all tour activities" : "Show counted tours only"}
        </Button>
      </div>
      <DataTable
        columns={[
          { key: "src", header: "Activity", render: (r: any) => <code className="text-xs">{r.source_id}</code> },
          { key: "com", header: "Community", render: (r: any) => ctx.communityNames[r.community_id ?? ""] ?? "—" },
          { key: "date", header: "Completed", render: (r: any) => r.completed_local_date ?? "—" },
          { key: "result", header: "Result", render: (r: any) => r.result_label ?? "—" },
          {
            key: "ok",
            header: "Counted",
            render: (r: any) => (r.successful ? "Yes" : "No"),
          },
          {
            key: "seq",
            header: "Sequence",
            render: (r: any) => (r.first_completed_of_type ? "Initial" : "Repeat"),
          },
          {
            key: "prospect",
            header: "Prospect",
            render: (r: any) => <code className="text-xs">{r.prospect_source_id ?? "—"}</code>,
          },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No tour activities" description="Nothing matches the current selection." />}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} {mode === "successful" ? "counted tours" : "tour activities"} · page{" "}
          {page + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

function DepositDrillThrough() {
  const ctx = useWhContext();
  const [page, setPage] = useState(0);
  const q = useWhDepositPage(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
    page,
    PAGE_SIZE,
  );
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Counted deposit transactions</h3>
        <p className="text-xs text-muted-foreground">
          Exactly the rows behind the Deposit candidate: transaction_type = Deposit and deposit_type
          = Deposit, dated in the selected period.
        </p>
      </div>
      <DataTable
        columns={[
          { key: "src", header: "Transaction", render: (r: any) => <code className="text-xs">{r.source_id}</code> },
          { key: "com", header: "Community", render: (r: any) => ctx.communityNames[r.community_id ?? ""] ?? "—" },
          { key: "date", header: "Date", render: (r: any) => r.occurred_local_date ?? "—" },
          { key: "type", header: "Deposit type", render: (r: any) => r.deposit_type ?? "—" },
          {
            key: "amt",
            header: "Amount",
            align: "right",
            render: (r: any) => (r.amount == null ? "—" : Number(r.amount).toLocaleString()),
          },
          {
            key: "prospect",
            header: "Prospect",
            render: (r: any) => <code className="text-xs">{r.prospect_source_id ?? "—"}</code>,
          },
        ]}
        rows={(q.data?.rows ?? []) as any[]}
        loading={q.isLoading}
        empty={<EmptyState title="No counted deposits" description="No standard deposit transactions in this selection." />}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} counted {total === 1 ? "deposit" : "deposits"} · page {page + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {

  return (
    <div className="panel space-y-1 p-5">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
