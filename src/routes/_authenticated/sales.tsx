import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { CandidateMetricCard, ProvisionalBadge, WithheldPanel } from "@/components/clarity/provisional";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activePipeline,
  candidateDeposits,
  candidateHotLeads,
  candidateHotNoFutureActivity,
  candidateInquiries,
  candidateMoveIns,
  candidateMoveOuts,
  candidateNetMoveIns,
  candidateReTours,
  candidateStalled,
  candidateTours,
  cohortConversion,
  depositReconciliation,
  occupancyComponents,
  overdueNextActivity,
  pendingMimo,
  prospectExclusionBreakdown,
  ratio,
  utmCoverage,
} from "@/lib/wh/metrics";
import { WH_DEFAULT_SETTINGS } from "@/lib/wh/queries";
import { useWhContext, useWhFacts, useWhLabelMaps } from "@/lib/wh/use-wh";

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

function SalesIntelligence() {
  const ctx = useWhContext();
  const facts = useWhFacts(ctx.organizationId, ctx.communityIds);
  const labels = useWhLabelMaps(ctx.connectionId);
  const [tab, setTab] = useState("funnel");

  const settings = ctx.settings ?? {
    organization_id: ctx.organizationId ?? "",
    ...WH_DEFAULT_SETTINGS,
  };
  const start = ctx.dateRange.start;
  const end = ctx.dateRange.end;
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const m = useMemo(() => {
    const inquiries = candidateInquiries(facts.prospects, settings, ctx.tz, start, end);
    const tours = candidateTours(facts.activities, ctx.activityMap, start, end);
    const reTours = candidateReTours(facts.activities, ctx.activityMap, start, end);
    const deposits = candidateDeposits(facts.deposits, facts.contracts, settings, start, end);
    const moveIns = candidateMoveIns(facts.contracts, settings, start, end);
    const moveOuts = candidateMoveOuts(facts.contracts, settings, start, end);
    return {
      inquiries,
      tours,
      reTours,
      deposits,
      moveIns,
      moveOuts,
      net: candidateNetMoveIns(moveIns, moveOuts),
      hot: candidateHotLeads(facts.prospects, settings, ctx.scoreMap),
      hotNoActivity: candidateHotNoFutureActivity(facts.prospects, settings, ctx.scoreMap, nowIso),
      stalled: candidateStalled(facts.prospects, settings, nowIso),
      overdue: overdueNextActivity(facts.prospects, settings, nowIso),
      pipeline: activePipeline(facts.prospects, settings),
      exclusions: prospectExclusionBreakdown(facts.prospects),
      depositRecon: depositReconciliation(facts.deposits, facts.contracts, start, end),
      pending: pendingMimo(facts.contracts, settings, today),
      occupancy: occupancyComponents(facts.units, facts.contracts, settings, today),
      cohort: cohortConversion({
        prospects: facts.prospects,
        activities: facts.activities,
        contracts: facts.contracts,
        deposits: facts.deposits,
        settings,
        activityMap: ctx.activityMap,
        tz: ctx.tz,
        start,
        end,
      }),
      utm: utmCoverage(facts.prospects),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, settings, ctx.tz, ctx.activityMap, ctx.scoreMap, start, end]);

  const counselors = useMemo(() => {
    const rows = new Map<
      string,
      { id: string; tours: number; activities: number; moveIns: number; pipeline: number }
    >();
    const get = (id: string) => {
      if (!rows.has(id)) rows.set(id, { id, tours: 0, activities: 0, moveIns: 0, pipeline: 0 });
      return rows.get(id)!;
    };
    for (const a of facts.activities) {
      const id = a.user_id_source;
      if (!id || a.discarded_at) continue;
      const d = a.completed_local_date;
      if (!d || d < start || d > end) continue;
      const row = get(id);
      row.activities += 1;
      if (a.activity_type_id && ctx.activityMap[a.activity_type_id] === "tour") row.tours += 1;
    }
    for (const c of facts.contracts) {
      if (!c.sales_counselor_id || c.count_move_in !== true) continue;
      const d = settings.move_in_date_field === "financial_move_in_date" ? c.financial_move_in_date : c.move_in_date;
      if (!d || d < start || d > end) continue;
      get(c.sales_counselor_id).moveIns += 1;
    }
    for (const p of m.pipeline) {
      if (p.current_sales_counselor_id) get(p.current_sales_counselor_id).pipeline += 1;
    }
    return [...rows.values()].sort((a, b) => b.activities - a.activities);
  }, [facts.activities, facts.contracts, m.pipeline, ctx.activityMap, settings.move_in_date_field, start, end]);

  const leadSources = useMemo(() => {
    const rows = new Map<string, { id: string; inquiries: number; moveIns: number }>();
    const get = (id: string) => {
      if (!rows.has(id)) rows.set(id, { id, inquiries: 0, moveIns: 0 });
      return rows.get(id)!;
    };
    const inquiryIds = new Set(m.inquiries.resolved ? m.inquiries.ids : []);
    const bySource = new Map<string, string>();
    for (const p of facts.prospects) {
      bySource.set(p.source_id, p.lead_source_id ?? "unknown");
      if (inquiryIds.has(p.id)) get(p.lead_source_id ?? "unknown").inquiries += 1;
    }
    for (const c of facts.contracts) {
      if (c.count_move_in !== true || !c.prospect_source_id) continue;
      const d = settings.move_in_date_field === "financial_move_in_date" ? c.financial_move_in_date : c.move_in_date;
      if (!d || d < start || d > end) continue;
      get(bySource.get(c.prospect_source_id) ?? "unknown").moveIns += 1;
    }
    return [...rows.values()].sort((a, b) => b.inquiries - a.inquiries);
  }, [facts.prospects, facts.contracts, m.inquiries, settings.move_in_date_field, start, end]);

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

  if (facts.loading || ctx.loading) {
    return <div className="panel px-6 py-16 text-center text-sm text-muted-foreground">Loading CRM data…</div>;
  }

  if (facts.empty) {
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Sales Intelligence"
        description="Every number below is a count of WelcomeHome records, converted to community-local dates. Definitions still awaiting reconciliation are labelled provisional; unresolvable ones are withheld rather than guessed."
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
            <CandidateMetricCard label="New inquiries" candidate={m.inquiries} />
            <CandidateMetricCard label="Completed tours" candidate={m.tours} />
            <CandidateMetricCard label="Re-tours" candidate={m.reTours} />
            <CandidateMetricCard label="Deposits" candidate={m.deposits} />
            <CandidateMetricCard label="Move-ins" candidate={m.moveIns} />
            <CandidateMetricCard label="Move-outs" candidate={m.moveOuts} />
            <CandidateMetricCard label="Net move-ins" candidate={m.net} />
            <div className="panel space-y-1 p-5">
              <p className="eyebrow">Pending move-ins / outs</p>
              <p className="font-display text-2xl font-semibold">
                {m.pending.pendingIn} / {m.pending.pendingOut}
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
              <Stat label="Cohort size" value={m.cohort.cohortSize} />
              <Stat label="Toured" value={m.cohort.toured ?? "—"} sub={pct(ratio(m.cohort.toured, m.cohort.cohortSize))} />
              <Stat label="Deposited" value={m.cohort.deposited} sub={pct(ratio(m.cohort.deposited, m.cohort.cohortSize))} />
              <Stat label="Moved in" value={m.cohort.movedIn} sub={pct(ratio(m.cohort.movedIn, m.cohort.cohortSize))} />
            </div>
            {m.cohort.linkageCoverage != null && m.cohort.linkageCoverage < 0.95 ? (
              <p className="text-xs text-warning">
                Only {pct(m.cohort.linkageCoverage)} of activities carry a prospect link, so
                tour-level conversion understates reality. Treat it as a floor, not a rate.
              </p>
            ) : null}
            {m.cohort.toured == null ? (
              <p className="text-xs text-muted-foreground">
                Tour conversion is withheld until an activity type is mapped to Tour.
              </p>
            ) : null}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel space-y-2 p-5">
              <h3 className="text-sm font-semibold">Prospect exclusions</h3>
              <p className="text-xs text-muted-foreground">
                Records are retained for audit and excluded from counts, never deleted.
              </p>
              <ul className="text-sm text-muted-foreground">
                <li>Total prospects loaded: {m.exclusions.total}</li>
                <li>Merged duplicates excluded: {m.exclusions.merged}</li>
                <li>Discarded excluded: {m.exclusions.discarded}</li>
                <li className="text-foreground">Countable: {m.exclusions.countable}</li>
              </ul>
            </div>
            <div className="panel space-y-2 p-5">
              <h3 className="text-sm font-semibold">Deposit source comparison</h3>
              <p className="text-xs text-muted-foreground">
                Both candidate sources are shown side by side until V-003 is reconciled.
              </p>
              <ul className="text-sm text-muted-foreground">
                <li>DepositTransactions: {m.depositRecon.fromTransactions}</li>
                <li>HousingContract deposit fields: {m.depositRecon.fromContracts}</li>
              </ul>
              {m.depositRecon.fromTransactions !== m.depositRecon.fromContracts ? (
                <p className="text-xs text-warning">
                  The two sources disagree. Resolve V-003 before treating deposits as validated.
                </p>
              ) : null}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-6 pt-6">
          <section className="grid gap-4 md:grid-cols-4">
            <Stat label="Open pipeline" value={m.pipeline.length} sub="Current state" />
            <CandidateMetricCard label="Hot leads" candidate={m.hot} />
            <CandidateMetricCard label="Hot, no future activity" candidate={m.hotNoActivity} />
            <CandidateMetricCard label="Stalled prospects" candidate={m.stalled} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Overdue next activity</h2>
            <DataTable
              columns={[
                { key: "src", header: "Prospect", render: (p: any) => <code className="text-xs">{p.source_id}</code> },
                { key: "com", header: "Community", render: (p: any) => ctx.communityNames[p.community_id ?? ""] ?? "—" },
                { key: "stage", header: "Stage", render: (p: any) => labels.stage[p.stage_id ?? ""] ?? "—" },
                { key: "score", header: "Score", render: (p: any) => labels.score[p.score_id ?? ""] ?? "—" },
                {
                  key: "next",
                  header: "Scheduled",
                  render: (p: any) => (
                    <span className="text-xs">{p.next_activity_scheduled_at?.slice(0, 10) ?? "—"}</span>
                  ),
                },
                {
                  key: "counselor",
                  header: "Counselor",
                  render: (p: any) => labels.user[p.current_sales_counselor_id ?? ""] ?? "—",
                },
              ]}
              rows={m.overdue.slice(0, 100) as any[]}
              empty={<EmptyState title="Nothing overdue" description="No open prospect has a past-due scheduled activity." />}
            />
          </section>

          <WithheldPanel
            title="Stage distribution over time is not available"
            description="Historical stage distribution requires WelcomeHome Daily Snapshots. Only current stage state is stored today, so a trend line would be a reconstruction rather than a measurement."
          >
            <DataTable
              columns={[
                { key: "stage", header: "Current stage", render: (r: any) => labels.stage[r.id] ?? r.id },
                { key: "n", header: "Open prospects", align: "right", render: (r: any) => r.n },
              ]}
              rows={Object.entries(
                m.pipeline.reduce<Record<string, number>>((acc, p) => {
                  const k = p.stage_id ?? "unknown";
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([id, n]) => ({ id, n })) as any[]}
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
            rows={counselors as any[]}
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
            rows={leadSources as any[]}
            empty={<EmptyState title="No lead source data" />}
          />
          <div className="panel space-y-2 p-5">
            <h3 className="text-sm font-semibold">Digital metadata coverage</h3>
            <p className="text-xs text-muted-foreground">
              How often UTM values arrive on prospect records. Cross-source attribution is a later
              phase; this is a readiness measurement only.
            </p>
            <ul className="text-sm text-muted-foreground">
              {Object.entries(m.utm.counts).map(([k, v]) => (
                <li key={k}>
                  {k}: {v} of {m.utm.total} ({pct(ratio(v, m.utm.total))})
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
              <Stat label="Total units" value={m.occupancy.totalUnits} />
              <Stat label="Off-census units" value={m.occupancy.offCensusUnits} />
              <Stat label="Census units" value={m.occupancy.censusUnits} />
              <Stat label="Occupied (candidate)" value={m.occupancy.occupiedUnitsCandidate} />
              <Stat label="On notice" value={m.occupancy.noticeCount} />
              <Stat label="Pending move-ins" value={m.occupancy.pendingMoveIns} />
            </div>
            <p className="pt-3 text-xs text-muted-foreground">
              Candidate ratio, shown for reconciliation only: {pct(m.occupancy.candidatePct)}
            </p>
          </WithheldPanel>
        </TabsContent>
      </Tabs>
    </div>
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
