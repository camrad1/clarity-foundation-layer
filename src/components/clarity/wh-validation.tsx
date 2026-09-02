import { useMemo } from "react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { StatusPill } from "@/components/clarity/status-pill";
import { WH_DEFAULT_SETTINGS } from "@/lib/wh/queries";
import { useWhSalesSummary } from "@/lib/wh/summary";
import { useWhContext } from "@/lib/wh/use-wh";

/**
 * The open WelcomeHome definition questions (V-001 … V-007). Each row states
 * the question, the provisional choice currently in force, and the candidate
 * value that choice produces for the selected period, so the value can be
 * compared against WelcomeHome's own reporting before anything is approved.
 *
 * Candidate values come from the database aggregate, over the full dataset.
 */
export function WhValidationQueue() {
  const ctx = useWhContext();
  const summary = useWhSalesSummary(
    ctx.organizationId,
    ctx.communityIds,
    ctx.dateRange.start,
    ctx.dateRange.end,
  );
  const settings = ctx.settings ?? { organization_id: ctx.organizationId ?? "", ...WH_DEFAULT_SETTINGS };
  const s = summary.data;

  const rows = useMemo(() => {
    if (!s) return [];
    const recon = s.depositRecon;
    const occ = s.occupancy;

    return [
      {
        id: "V-001",
        question: "Which date defines a new inquiry?",
        choice: settings.inquiry_date_field,
        candidate: String(s.inquiries),
        state: "pending",
        detail: "Compare against WelcomeHome's own new-lead report for the same period.",
      },
      {
        id: "V-002",
        question: "Which tour activities count, and is Re-Tour distinct?",
        choice: s.mappings.tour
          ? "Tour activity AND WelcomeHome activity result flagged successful, completed in the period"
          : "Not mapped",
        candidate: s.mappings.tour
          ? `${s.tourRecon.successfulTours} successful tours (initial ${s.tourRecon.initialTours}, repeat ${s.tourRecon.repeatTours}) of ${s.tourRecon.totalTourActivities} total tour activities; ${s.tourRecon.unsuccessfulTours} unsuccessful excluded`
          : "Withheld",
        state: s.mappings.tour ? "pending" : "needs_review",
        detail:
          "PROVISIONAL — matched to WelcomeHome Flash Activities for The Esther, Aug 1–31 2026 (successful 21 vs 21, initial 16, repeat 5, total 25). Successful is matched on the WelcomeHome ActivityResult source ID flagged successful in the lookup payload — never on the result label, which is display only. Initial vs repeat uses WelcomeHome's first_completed_of_activity_type flag, never an inferred tour sequence.",
      },
      {
        id: "V-003",
        question: "Are deposits counted from DepositTransactions or contract fields?",
        choice:
          "Distinct depositors with a standard deposit (transaction_type = Deposit AND deposit_type = Deposit, amount > 0) dated in the period",
        candidate: `${s.deposits} depositors (from ${recon.fromTransactions} standard transaction rows; ${recon.zeroAmountRows} zero-amount adjustments, ${recon.refunds} refunds, ${recon.waitlist} waitlist, ${recon.otherTypes} other types excluded; contracts ${recon.fromContracts})`,
        state: "pending",
        detail:
          "PROVISIONAL — depositor-based rule matched to the WelcomeHome Depositor List. The Esther Aug 2026 returns 5 (official 5). The Rawlin Aug 2026 returns 2 against an official 3: the third depositor's standard deposit is dated 2026-09-01 in the WelcomeHome API while the official Depositor List shows 08/25, so the rule was NOT bent to force a match. Deposit dates now use the source calendar date; the previous timezone conversion shifted them one day earlier. Refunds and waitlist rows are preserved but never counted; amount sign is never used.",
      },

      {
        id: "V-004",
        question: "Which contract dates define move-in and move-out?",
        choice: `${settings.move_in_date_field} / ${settings.move_out_date_field}, count_move_in / count_move_out true, canceled leases excluded`,
        candidate: `${s.moveIns} in / ${s.moveOuts} out (transfer ins ${s.moveRecon.transferIns}, transfer outs ${s.moveRecon.transferOuts}, canceled excluded ${s.moveRecon.canceledMoveIns} in / ${s.moveRecon.canceledMoveOuts} out)`,
        state: "pending",
        detail:
          "PROVISIONAL — matched across two communities for Aug 2026: The Esther 2 in / 2 out and The Rawlin 7 in / 7 out, both equal to the official Rack & Stack. Transfer Ins carry count_move_in = false in the source and are therefore already excluded; the normalized is_transfer flag is NULL portfolio-wide and is deliberately not used. Canceled leases (lease_canceled_on set) are excluded but retained for audit.",
      },

      {
        id: "V-005",
        question: "How is occupancy defined against census units? (current state only)",
        choice:
          "Current-state census-eligible residential units only — excludes off-census flags, discarded/inactive units and recognized non-residential pseudo-units (WAITLIST)",
        candidate: `${occ.occupiedUnitsCandidate} of ${occ.censusUnits} census-eligible units (${
          occ.censusUnits
            ? `${((occ.occupiedUnitsCandidate / occ.censusUnits) * 100).toFixed(1)}% raw / ${Math.round(
                (occ.occupiedUnitsCandidate / occ.censusUnits) * 100,
              )}% rounded`
            : "—"
        }); ${occ.totalUnits} total unit records, ${occ.offCensusUnits} off-census, ${occ.pseudoUnits} pseudo-unit, ${occ.inactiveUnits} inactive`,
        state: "pending",
        detail:
          "CURRENT OCCUPANCY FORMULA RECONCILED for The Esther (92 of 103 census-eligible units = 89.3% raw / 89% rounded; census 103 of 104 unit records, the WAITLIST pseudo-unit excluded by a configurable rule, never a community-specific override). These components describe current source state and are NOT affected by the selected date range. HISTORICAL OCCUPANCY AS-OF DATE IS UNAVAILABLE: no historical-state source exists until WelcomeHome Daily Snapshots are enabled and validated, so historical wh.occupancy_pct stays unpublished and is never reconstructed from present-state rows.",
      },


      {
        id: "V-006",
        question: "Which prospects are excluded from counts?",
        choice: `merged ${settings.exclude_merged_prospects ? "excluded" : "included"}, discarded ${
          settings.exclude_discarded_prospects ? "excluded" : "included"
        }`,
        candidate: `${s.exclusions.countable} countable of ${s.exclusions.total} stored`,
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
  }, [s, settings]);

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
        loading={summary.isLoading || ctx.loading}
        empty={<EmptyState title="No definition questions" />}
      />
    </div>
  );
}
