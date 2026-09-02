import { useMemo } from "react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { StatusPill } from "@/components/clarity/status-pill";
import {
  candidateDeposits,
  candidateInquiries,
  candidateMoveIns,
  candidateMoveOuts,
  candidateReTours,
  candidateTours,
  depositReconciliation,
  occupancyComponents,
} from "@/lib/wh/metrics";
import { WH_DEFAULT_SETTINGS } from "@/lib/wh/queries";
import { useWhContext, useWhFacts } from "@/lib/wh/use-wh";

/**
 * The open WelcomeHome definition questions (V-001 … V-007). Each row states
 * the question, the provisional choice currently in force, and the candidate
 * value that choice produces for the selected period, so the value can be
 * compared against WelcomeHome's own reporting before anything is approved.
 */
export function WhValidationQueue() {
  const ctx = useWhContext();
  const facts = useWhFacts(ctx.organizationId, ctx.communityIds);
  const settings = ctx.settings ?? { organization_id: ctx.organizationId ?? "", ...WH_DEFAULT_SETTINGS };
  const start = ctx.dateRange.start;
  const end = ctx.dateRange.end;
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const inquiries = candidateInquiries(facts.prospects, settings, ctx.tz, start, end);
    const tours = candidateTours(facts.activities, ctx.activityMap, start, end);
    const reTours = candidateReTours(facts.activities, ctx.activityMap, start, end);
    const deposits = candidateDeposits(facts.deposits, facts.contracts, settings, start, end);
    const recon = depositReconciliation(facts.deposits, facts.contracts, start, end);
    const moveIns = candidateMoveIns(facts.contracts, settings, start, end);
    const moveOuts = candidateMoveOuts(facts.contracts, settings, start, end);
    const occ = occupancyComponents(facts.units, facts.contracts, settings, today);

    const val = (c: ReturnType<typeof candidateTours>) =>
      c.resolved ? String(c.value) : "Withheld";

    return [
      {
        id: "V-001",
        question: "Which date defines a new inquiry?",
        choice: settings.inquiry_date_field,
        candidate: val(inquiries),
        state: inquiries.resolved ? "pending" : "needs_review",
        detail: "Compare against WelcomeHome's own new-lead report for the same period.",
      },
      {
        id: "V-002",
        question: "Which activity types are tours, and is Re-Tour distinct?",
        choice: Object.values(ctx.activityMap).includes("tour") ? "Tour mapped" : "Not mapped",
        candidate: `${val(tours)} tours / ${val(reTours)} re-tours`,
        state: tours.resolved ? "pending" : "needs_review",
        detail: "Re-tours are never inferred from a second tour on the same prospect.",
      },
      {
        id: "V-003",
        question: "Are deposits counted from DepositTransactions or contract fields?",
        choice: settings.deposit_source,
        candidate: `${val(deposits)} (transactions ${recon.fromTransactions} vs contracts ${recon.fromContracts})`,
        state: recon.fromTransactions === recon.fromContracts ? "pending" : "mismatch",
        detail: "Refunded and discarded deposits are excluded from the transaction count.",
      },
      {
        id: "V-004",
        question: "Which contract dates define move-in and move-out?",
        choice: `${settings.move_in_date_field} / ${settings.move_out_date_field}`,
        candidate: `${val(moveIns)} in / ${val(moveOuts)} out`,
        state: "pending",
        detail: "Only contracts flagged count_move_in / count_move_out are included.",
      },
      {
        id: "V-005",
        question: "How is occupancy defined against census units?",
        choice: "Withheld — not published",
        candidate: `${occ.occupiedUnitsCandidate} of ${occ.censusUnits} census units`,
        state: "needs_review",
        detail: "No occupancy KPI is published until reconciled against operational census.",
      },
      {
        id: "V-006",
        question: "Which prospects are excluded from counts?",
        choice: `merged ${settings.exclude_merged_prospects ? "excluded" : "included"}, discarded ${
          settings.exclude_discarded_prospects ? "excluded" : "included"
        }`,
        candidate: `${facts.prospects.length} loaded`,
        state: "pending",
        detail: "Excluded rows are retained for audit and drill-through.",
      },
      {
        id: "V-007",
        question: "What counts as a stalled or unattended hot lead?",
        choice: `${settings.stalled_threshold_days} days, ${settings.hot_no_activity_mode}`,
        candidate: "Configured policy",
        state: "pending",
        detail: "Thresholds are configuration, never hard-coded in a calculation.",
      },
    ];
  }, [facts, settings, ctx.tz, ctx.activityMap, start, end, today]);

  if (!ctx.connection) {
    return (
      <EmptyState
        title="WelcomeHome is not connected"
        description="The CRM definition queue appears once a WelcomeHome connection exists."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">WelcomeHome definition queue</h2>
        <p className="text-xs text-muted-foreground">
          Open questions that must be answered with WelcomeHome before any wh.* metric can leave
          provisional status. Candidate values reflect the current global filters.
        </p>
      </div>
      <DataTable
        columns={[
          { key: "id", header: "ID", render: (r: any) => <code className="text-xs">{r.id}</code> },
          { key: "q", header: "Question", render: (r: any) => r.question },
          { key: "choice", header: "Provisional choice", render: (r: any) => <span className="text-xs">{r.choice}</span> },
          { key: "cand", header: "Candidate value", render: (r: any) => <span className="text-xs">{r.candidate}</span> },
          { key: "state", header: "State", render: (r: any) => <StatusPill status={r.state} /> },
          { key: "detail", header: "Notes", render: (r: any) => <span className="text-xs text-muted-foreground">{r.detail}</span> },
        ]}
        rows={rows as any[]}
        loading={facts.loading || ctx.loading}
        empty={<EmptyState title="No definition questions" />}
      />
    </div>
  );
}
