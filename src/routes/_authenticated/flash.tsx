import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Info, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { ProvisionalBadge } from "@/components/clarity/provisional";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useOrgRole } from "@/lib/clarity-queries";
import { resolveLabel, useWhContext, useWhLabelMaps } from "@/lib/wh/use-wh";
import {
  useDeleteFlashBudget,
  useDeleteFlashEntry,
  useFlashBudgets,
  useFlashDeposits,
  useFlashEntries,
  useFlashHotLeads,
  useFlashMoveIns,
  useFlashMoveOuts,
  useFlashNotices,
  useFlashNotes,
  useFlashReport,
  useSaveFlashBudget,
  useSaveFlashEntry,
  useSaveFlashNote,
  type FlashPeriod,
  type FlashReport,
} from "@/lib/flash/queries";
import {
  addDays,
  currentFlashWeek,
  formatDay,
  formatFlashRange,
  formatMonth,
  monthEnd,
  monthStart,
  nextMonthStart,
  previousFlashWeek,
  recentMonths,
  todayISO,
  type FlashWeek,
} from "@/lib/flash/period";

export const Route = createFileRoute("/_authenticated/flash")({
  head: () => ({
    meta: [
      { title: "Flash Report — ClarityIQ" },
      {
        name: "description",
        content:
          "The Friday–Thursday operational Flash: occupancy versus budget, move-ins and move-outs, weekly sales activity and the monthly trackers leadership already knows.",
      },
      { property: "og:title", content: "Flash Report — ClarityIQ" },
      {
        property: "og:description",
        content: "Automated Friday–Thursday Flash reporting built on validated WelcomeHome metrics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlashReportPage,
});

/* -------------------------------------------------------------- */
/* small presentation helpers                                       */
/* -------------------------------------------------------------- */

function Section({
  title,
  description,
  badge,
  actions,
  children,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow text-foreground">{title}</h2>
          {badge}
        </div>
        {actions ? <div className="flex items-center gap-2 no-print">{actions}</div> : null}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "up" | "down";
  hint?: string;
}) {
  return (
    <div className="kpi-card space-y-1 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-display text-xl font-semibold tracking-tight",
          tone === "up" && "text-success",
          tone === "down" && "text-destructive",
          tone === "neutral" && "text-brand",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CurrentStateBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      Current state
    </span>
  );
}

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pct1 = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Neutral fallback so raw reference ids never surface as a person's name. */
function personName(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t.length ? t : "Name unavailable";
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const body = rows
    .map((r) =>
      r
        .map((cell) => {
          const v = cell == null ? "" : String(cell);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------- */

function FlashReportPage() {
  const { organizationId, communityIds, communityNames, loading } = useWhContext();
  const { isOrgAdmin } = useOrgRole(organizationId);
  const labels = useWhLabelMaps(useWhContext().connectionId);

  const today = todayISO();
  const [mode, setMode] = useState<"current" | "previous" | "custom">("current");
  const [customStart, setCustomStart] = useState<string>(currentFlashWeek(today).start);
  const [month, setMonth] = useState<string>(monthStart(today));

  const week: FlashWeek = useMemo(() => {
    if (mode === "previous") return previousFlashWeek(today);
    if (mode === "custom") return { start: customStart, end: addDays(customStart, 6) };
    return currentFlashWeek(today);
  }, [mode, customStart, today]);

  const report = useFlashReport(organizationId, communityIds, week.start, week.end, month);
  const data = report.data;

  const mStart = monthStart(month);
  const mEnd = monthEnd(month);
  const nmStart = nextMonthStart(month);
  const nmEnd = monthEnd(nmStart);

  const moveIns = useFlashMoveIns(organizationId, communityIds, mStart, mEnd);
  const moveOuts = useFlashMoveOuts(organizationId, communityIds, mStart, mEnd);
  const deposits = useFlashDeposits(organizationId, communityIds, mStart, mEnd);
  const hotLeads = useFlashHotLeads(organizationId, communityIds);
  const notices = useFlashNotices(organizationId, communityIds, nmStart, nmEnd);
  const entries = useFlashEntries(organizationId, communityIds, mStart, mEnd);
  const notes = useFlashNotes(organizationId, communityIds, mStart);

  const scopeLabel =
    communityIds.length === 1
      ? (communityNames[communityIds[0]!] ?? "1 community")
      : communityIds.length === 0
        ? "All authorized communities"
        : `${communityIds.length} communities`;

  const occ = data?.occupancy ?? null;
  const budgetUnits = data?.budget?.units ?? null;
  const occupied = occ?.occupiedUnits ?? null;
  const census = occ?.censusUnits ?? null;
  const variance = occupied != null && budgetUnits != null ? occupied - budgetUnits : null;
  const occPct = occupied != null && census ? occupied / census : null;
  const budgetPct =
    occupied != null && budgetUnits ? occupied / budgetUnits : (data?.budget?.pct ?? null) != null && occPct != null ? occPct : null;

  const exportGrid = () => {
    const careTypes = careTypeColumns(occ);
    const header = [
      "Week / Date", "Date range", "Total Units", "Unit Occ", "Unit Budget", "Variance",
      "OCC %", "Budget %", ...careTypes,
      "MIs", "MOs", "NET", "Pending Move Ins", "Pending Outs", "NET",
      "Inquiries", "Outreach Contacts", "Tours", "Re-Tours",
    ];
    const starting = [
      "Starting #", "", ...Array(6 + careTypes.length).fill("—"),
      ...Array(10).fill(""),
    ];
    const rowsOut = [...(data?.weeks ?? []), ...(data ? [data.month] : [])].map((w) =>
      gridRow(w, occ?.totalUnits ?? null, careTypes),
    );
    downloadCsv(`flash-${formatMonth(month).replace(" ", "-").toLowerCase()}.csv`, [header, starting, ...rowsOut]);
  };


  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Flash context…</p>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operational reporting"
        title="Flash Report"
        description="Friday–Thursday operational Flash, due EOD Thursday. Automated from validated WelcomeHome metrics, with manual Flash fields where the source has no equivalent."
        actions={
          <div className="flex items-center gap-2 no-print">
            <Button variant="outline" size="sm" onClick={exportGrid}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" /> Print / PDF
            </Button>
          </div>
        }
      />

      {/* Print-only report identification */}
      <div className="print-only hidden space-y-1">
        <p className="text-sm font-semibold">{scopeLabel}</p>
        <p className="text-xs">
          Flash week {formatFlashRange(week)} · Month {formatMonth(month)} · Generated{" "}
          {new Date().toLocaleString()}
        </p>
      </div>

      {/* Sticky Flash controls */}
      <div className="sticky top-16 z-10 -mx-2 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background/90 px-3 py-3 backdrop-blur no-print">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Flash week</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current Flash week</SelectItem>
              <SelectItem value="previous">Previous Flash week</SelectItem>
              <SelectItem value="custom">Custom Flash week</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "custom" ? (
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Week starting (Friday)</Label>
            <Input
              type="date"
              className="h-9 w-[160px]"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Month</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recentMonths(today).map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonth(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-right text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{formatFlashRange(week)}</p>
          <p>{scopeLabel} · due EOD Thursday</p>
        </div>
      </div>

      {report.error ? (
        <EmptyState
          title="Flash report unavailable"
          description={(report.error as Error).message}
        />
      ) : null}

      {/* 1. COMPACT CURRENT SUMMARY — deliberately dense so the week-by-week
          grid below stays the centerpiece of the page. */}
      <Section
        title="Current summary"
        badge={<CurrentStateBadge />}
        description="Occupancy reflects current WelcomeHome contract and unit state as of today. Historical as-of-Thursday occupancy requires the nightly snapshot system, which is not built yet. Move-ins, move-outs and sales activity are for the selected Flash week."
      >
        <div className="panel-brand divide-y divide-brand-border/70">
          <CompactRow
            heading="Current weekly summary"
            items={[
              { label: "Total units", value: num(occ?.totalUnits) },
              { label: "Census", value: num(census) },
              { label: "Unit occ", value: num(occupied) },
              { label: "Unit budget", value: budgetUnits == null ? "Not set" : num(budgetUnits) },
              {
                label: "Variance",
                value: variance == null ? "—" : variance > 0 ? `+${variance}` : String(variance),
                tone: variance == null ? "neutral" : variance >= 0 ? "up" : "down",
              },
              { label: "OCC %", value: pct1(occPct) },
              { label: "Budget %", value: pct1(budgetPct) },
              { label: "On notice", value: num(occ?.noticeCount) },
              ...(occ && occ.byCareType.length > 1
                ? occ.byCareType.map((c) => ({
                    label: c.careType,
                    value: `${c.occupied}/${c.units}`,
                  }))
                : []),
            ]}
          />
          <CompactRow
            heading="Current MIMO"
            items={[
              { label: "MIs", value: num(data?.week.moveIns) },
              { label: "MOs", value: num(data?.week.moveOuts) },
              {
                label: "Net",
                value: data ? (data.week.net > 0 ? `+${data.week.net}` : String(data.week.net)) : "—",
                tone: !data ? "neutral" : data.week.net > 0 ? "up" : data.week.net < 0 ? "down" : "neutral",
              },
            ]}
          />
          <CompactRow
            heading={`This month — pending MIMO (${formatMonth(month)})`}
            items={[
              { label: "Pending Move Ins", value: num(data?.month.pendingIn) },
              { label: "Pending Outs", value: num(data?.month.pendingOut) },
              { label: "Net", value: data ? String(data.month.pendingNet) : "—" },
            ]}
          />
          <CompactRow
            heading="Weekly sales update"
            items={[
              { label: "Inquiries", value: num(data?.week.inquiries) },
              {
                label: "Outreach Contacts",
                value: data?.week.outreachMapped === false ? "Not mapped" : num(data?.week.outreach),
              },
              { label: "Tours", value: num(data?.week.tours) },
              { label: "Re-Tours", value: num(data?.week.reTours) },
            ]}
          />
        </div>
      </Section>

      {/* 2. MONTHLY WEEK-BY-WEEK GRID — the primary operational Flash view */}
      <Section
        title={`${formatMonth(month)} — Week by Week`}
        description="Friday–Thursday weeks ending inside the month, plus month end."
      >
        <WeekByWeekGrid data={data} loading={report.isLoading} occ={occ} />
        <p className="pt-2 text-[11px] text-muted-foreground">
          Historical occupancy values will populate once nightly snapshots are enabled. Missing values are
          shown as “—” and are never filled with current-state data.
        </p>
      </Section>


      {/* 6. NEXT MONTH PENDING MIMO */}
      <Section
        title={`Next month pending MIMO (${formatMonth(nmStart)})`}
        badge={<CurrentStateBadge />}
        description="Future-dated WelcomeHome contract state for next month."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Pending move-ins" value={num(data?.nextMonth.pendingIn)} />
          <Stat label="Pending move-outs / notices" value={num(data?.nextMonth.pendingOut)} />
          <Stat label="Net" value={data ? String(data.nextMonth.pendingNet) : "—"} />
        </div>
      </Section>

      {/* Monthly trackers — three-column compact layout on desktop */}
      <Section
        title="Monthly trackers"
        description="Compact operational view. Full detail remains available through Sales Intelligence drill-through."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <TrackerCard title={`Move-In Monthly Tracker (${moveIns.data?.total ?? 0})`} loading={moveIns.isLoading}>
            {(moveIns.data?.rows ?? []).length === 0 && !moveIns.isLoading ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">No counted move-ins in this month.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="thead-brand text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-1.5 text-left font-medium">Resident</th>
                    <th className="px-3 py-1.5 text-left font-medium">Move-In</th>
                    <th className="px-3 py-1.5 text-left font-medium">Care / Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {(moveIns.data?.rows ?? []).map((r: any) => (
                    <tr key={r.source_id} className="border-t border-brand-border/50">
                      <td className="max-w-[120px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.move_in_date)}</td>
                      <td className="max-w-[110px] truncate px-3 py-1.5 text-muted-foreground">
                        {r.care_type ?? "—"} · {r.unit_label ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TrackerCard>

          <TrackerCard
            title={`Deposit Monthly Tracker (${deposits.data?.total ?? 0})`}
            badge={<ProvisionalBadge />}
            loading={deposits.isLoading}
          >
            {(deposits.data?.rows ?? []).length === 0 && !deposits.isLoading ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">No standard deposits recorded in this month.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="thead-brand text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-1.5 text-left font-medium">Depositor</th>
                    <th className="px-3 py-1.5 text-left font-medium">Date</th>
                    <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                    <th className="px-3 py-1.5 text-left font-medium">Expected MI</th>
                  </tr>
                </thead>
                <tbody>
                  {(deposits.data?.rows ?? []).map((r: any) => (
                    <tr key={r.source_id} className="border-t border-brand-border/50">
                      <td className="max-w-[110px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.deposit_date)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{formatDay(r.expected_move_in_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TrackerCard>

          <TrackerCard title={`Hot Lead Monthly Tracker (${hotLeads.data?.total ?? 0})`} loading={hotLeads.isLoading}>
            {(hotLeads.data?.rows ?? []).length === 0 && !hotLeads.isLoading ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">No open prospects mapped to the Hot score.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="thead-brand text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-1.5 text-left font-medium">Resident/Prospect</th>
                    <th className="px-3 py-1.5 text-left font-medium">Stage</th>
                    <th className="px-3 py-1.5 text-left font-medium">Next activity / Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(hotLeads.data?.rows ?? []).map((r: any) => (
                    <tr key={r.source_id} className="border-t border-brand-border/50">
                      <td className="max-w-[110px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="max-w-[90px] truncate px-3 py-1.5 text-muted-foreground">
                        {resolveLabel(labels.stage, r.stage_id, "Unknown stage")}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          <span className="whitespace-nowrap">
                            {r.next_activity_scheduled_at ? new Date(r.next_activity_scheduled_at).toLocaleDateString() : "—"}
                          </span>
                          <NoteCell
                            organizationId={organizationId}
                            communityId={r.community_id}
                            subjectType="hot_lead"
                            subjectKey={r.source_id}
                            month={mStart}
                            weekStart={week.start}
                            notes={notes.data ?? {}}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TrackerCard>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Names come from the WelcomeHome record — “Name unavailable” appears only where the source has no
          usable name. Deposit remains provisional: only source-backed transactions are shown, nothing is
          inferred. See Validation Center.
        </p>
      </Section>

      {/* Trackers */}
      <Accordion type="multiple" defaultValue={["move-out", "notices", "events"]}>
        <AccordionItem value="move-out">
          <AccordionTrigger>Move-out monthly tracker ({moveOuts.data?.total ?? 0})</AccordionTrigger>
          <AccordionContent>
            <DataTable
              loading={moveOuts.isLoading}
              rows={moveOuts.data?.rows ?? []}
              empty={<EmptyState title="No move-outs" description="No counted move-outs in this month." />}
              columns={[
                { key: "name", header: "Resident", render: (r) => personName(r.person_name) },
                { key: "date", header: "Move-out date", render: (r) => formatDay(r.move_out_date) },
                { key: "care", header: "Care type / unit", render: (r) => `${r.care_type ?? "—"} · ${r.unit_label ?? "—"}` },
                { key: "reason", header: "Reason", render: (r) => r.reason ?? "Not provided by source" },
                {
                  key: "loc",
                  header: "Location (manual)",
                  render: (r) => (
                    <NoteCell
                      organizationId={organizationId}
                      communityId={r.community_id}
                      subjectType="move_out"
                      subjectKey={r.source_id}
                      month={mStart}
                      weekStart={week.start}
                      notes={notes.data ?? {}}
                      placeholder="Destination / notes"
                    />
                  ),
                },
              ] as Column<any>[]}
            />
            <p className="pt-2 text-[11px] text-muted-foreground">
              Destination/location is not exposed by the WelcomeHome API — it is a manual Flash field with
              author and timestamp retained.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="notices">
          <AccordionTrigger>
            Notices — next month pending move-out ({notices.data?.total ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <DataTable
              loading={notices.isLoading}
              rows={notices.data?.rows ?? []}
              empty={<EmptyState title="No upcoming notices" description={`No pending move-outs dated in ${formatMonth(nmStart)}.`} />}
              columns={[
                { key: "name", header: "Resident", render: (r) => personName(r.person_name) },
                { key: "notice", header: "Notice date", render: (r) => formatDay(r.notice_date) },
                { key: "mo", header: "Expected move-out", render: (r) => formatDay(r.expected_move_out_date) },
                { key: "care", header: "Care type / unit", render: (r) => `${r.care_type ?? "—"} · ${r.unit_label ?? "—"}` },
                { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
              ] as Column<any>[]}
            />
            <p className="pt-2 text-[11px] text-muted-foreground">
              Current-state contract data, not completed move-outs.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="events">
          <AccordionTrigger>Additional notes / events / networking ({entries.data?.length ?? 0})</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <EntryEditor
              organizationId={organizationId}
              communityIds={communityIds}
              communityNames={communityNames}
              month={mStart}
              weekStart={week.start}
            />
            <DataTable
              loading={entries.isLoading}
              rows={entries.data ?? []}
              empty={<EmptyState title="Nothing logged" description="Add referral visits, networking activity, events or Flash notes for this month." />}
              columns={[
                { key: "date", header: "Date", render: (r) => formatDay(r.entry_date) },
                { key: "src", header: "Source", render: () => <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">Manual Flash entry</span> },
                { key: "title", header: "Event / outreach detail", render: (r) => r.title },
                { key: "aud", header: "Target audience", render: (r) => r.target_audience ?? "—" },
                { key: "inv", header: "Invited / visited", align: "right", render: (r) => num(r.invited_count) },
                { key: "att", header: "Attended / completed", align: "right", render: (r) => num(r.attended_count) },
                { key: "notes", header: "Notes", render: (r) => r.notes ?? "—" },
                {
                  key: "del",
                  header: "",
                  render: (r) => <DeleteEntryButton id={r.id} />,
                },
              ] as Column<any>[]}
            />
            <p className="text-[11px] text-muted-foreground">
              Manual Flash entries are never counted as Outreach Contacts — that KPI comes only from mapped
              WelcomeHome activities. WelcomeHome Events/RSVP ingestion is not part of this pass, so no event
              rows are pulled from the API yet.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {isOrgAdmin ? (
        <Section
          title="Community settings — occupancy budget"
          description="Date-effective unit budget per community. Variance = unit occupancy − unit budget."
          actions={<BudgetDialog organizationId={organizationId} communityNames={communityNames} communityIds={communityIds} />}
        >
          <BudgetTable organizationId={organizationId} communityNames={communityNames} />
        </Section>
      ) : null}

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Automated Flash values are calculated server-side by <code>wh_flash_report</code> and the paginated
        tracker RPCs, reusing the validated WelcomeHome predicates. Manual Flash fields store author,
        timestamp, community and reporting period.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- */

/** Dense summary strip: legacy grouped heading + inline metrics. */
function CompactRow({
  heading,
  items,
}: {
  heading: string;
  items: { label: string; value: React.ReactNode; tone?: "neutral" | "up" | "down" }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-brand md:w-48 md:shrink-0">
        {heading}
      </p>
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        {items.map((it) => (
          <div key={it.label} className="min-w-[60px] space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {it.label}
            </p>
            <p
              className={cn(
                "font-display text-lg font-semibold leading-tight tabular-nums",
                it.tone === "up" && "text-success",
                it.tone === "down" && "text-destructive",
              )}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact tracker card used by the three-column monthly tracker row. */
function TrackerCard({
  title,
  badge,
  loading,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="panel flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-brand-border/70 bg-brand-soft px-3 py-2">
        <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand">{title}</h3>
        {badge}
      </div>
      <div className="max-h-[420px] min-w-0 overflow-auto">
        {loading ? <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p> : children}
      </div>
    </div>
  );
}


/* -------------------------------------------------------------- */
/* Week-by-week grid                                                */
/* -------------------------------------------------------------- */

/**
 * Care-type occupancy columns are derived from the community's configured care
 * types (`occupancy.byCareType`) — never hard-coded. A single-care-type scope
 * adds no columns.
 */
function careTypeColumns(occ: FlashReport["occupancy"] | null | undefined): string[] {
  const list = occ?.byCareType ?? [];
  return list.length > 1 ? list.map((c) => c.careType) : [];
}

function gridRow(w: FlashPeriod, totalUnits: number | null, careTypes: string[]) {
  const o = w.occupancy ?? null;
  const b = w.budget?.units ?? null;
  const occupied = o?.occupiedUnits ?? null;
  const variance = occupied != null && b != null ? occupied - b : null;
  return [
    w.label,
    `${w.start} → ${w.end}`,
    o ? o.totalUnits : (totalUnits ?? ""),
    occupied ?? "—",
    b ?? "",
    variance ?? "",
    occupied != null && o?.censusUnits ? ((occupied / o.censusUnits) * 100).toFixed(1) : "",
    occupied != null && b ? ((occupied / b) * 100).toFixed(1) : "",
    ...careTypes.map((ct) => {
      const row = o?.byCareType.find((c) => c.careType === ct);
      return row ? `${row.occupied}/${row.units}` : "snapshot required";
    }),
    w.moveIns,
    w.moveOuts,
    w.net,
    w.pendingIn,
    w.pendingOut,
    w.pendingNet,
    w.inquiries,
    w.outreach,
    w.tours,
    w.reTours,
  ];
}

const GROUP_BORDER = "border-l border-brand-border";

function WeekByWeekGrid({
  data,
  loading,
  occ,
}: {
  data: FlashReport | undefined;
  loading: boolean;
  occ: FlashReport["occupancy"] | null;
}) {
  const careTypes = careTypeColumns(occ);
  const groups: { label: string; cols: string[] }[] = [
    { label: "Current weekly summary", cols: ["Total Units", "Unit Occ", "Unit Budget", "Variance", "OCC %", "Budget %", ...careTypes] },
    { label: "Current MIMO", cols: ["MIs", "MOs", "NET"] },
    { label: "This month – pending MIMO", cols: ["Pending Move Ins", "Pending Outs", "NET"] },
    { label: "Weekly sales update", cols: ["Inquiries", "Outreach Contacts", "Tours", "Re-Tours"] },
  ];
  const totalCols = 1 + groups.reduce((n, g) => n + g.cols.length, 0);

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          {/* Grouped legacy heading row — visually dominant */}
          <tr className="thead-brand-strong text-[11px] font-semibold uppercase tracking-wider">
            <th className="whitespace-nowrap px-3 py-2 text-left">Week / Date</th>
            {groups.map((g) => (
              <th
                key={g.label}
                colSpan={g.cols.length}
                className={cn("whitespace-nowrap px-3 py-2 text-center", "border-l border-white/25")}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* Subheading row — lighter */}
          <tr className="thead-brand border-b border-brand-border text-[10px] uppercase tracking-wide text-foreground/70">
            <th className="px-3 py-1.5 text-left font-medium" />
            {groups.map((g) =>
              g.cols.map((c, i) => (
                <th
                  key={`${g.label}-${c}`}
                  className={cn("whitespace-nowrap px-3 py-1.5 text-center font-medium", i === 0 && GROUP_BORDER)}
                >
                  {c}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {/* Legacy "Starting #" row. Structured now; populated once immutable
              daily snapshots exist. Current-state occupancy is deliberately NOT
              backfilled here. */}
          <StartingRow careTypes={careTypes} totalCols={totalCols} />
          {(data?.weeks ?? []).map((w) => (
            <GridRow key={w.start} w={w} totalUnits={occ?.totalUnits ?? null} careTypes={careTypes} />
          ))}
          {data ? (
            <GridRow w={data.month} totalUnits={occ?.totalUnits ?? null} careTypes={careTypes} emphasis />
          ) : null}
          {!data && !loading ? (
            <tr>
              <td className="px-3 py-6 text-muted-foreground" colSpan={totalCols}>
                No Flash data for this month.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function StartingRow({ careTypes, totalCols }: { careTypes: string[]; totalCols: number }) {
  const occCols = 6 + careTypes.length;
  return (
    <tr className="border-b border-brand-border/70 bg-brand-soft text-muted-foreground">
      <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">Starting #</td>
      {Array.from({ length: occCols }).map((_, i) => (
        <td key={`s-occ-${i}`} className={cn("px-3 py-2 text-center tabular-nums", i === 0 && GROUP_BORDER)}>
          —
        </td>
      ))}
      {Array.from({ length: totalCols - 1 - occCols }).map((_, i) => (
        <td key={`s-rest-${i}`} className={cn("px-3 py-2 text-center tabular-nums", i === 0 && GROUP_BORDER)}>
          —
        </td>
      ))}
    </tr>
  );
}

function GridRow({
  w,
  totalUnits,
  careTypes,
  emphasis,
}: {
  w: FlashPeriod;
  totalUnits: number | null;
  careTypes: string[];
  emphasis?: boolean;
}) {
  const o = w.occupancy ?? null;
  const b = w.budget?.units ?? null;
  const occupied = o?.occupiedUnits ?? null;
  const variance = occupied != null && b != null ? occupied - b : null;
  const na = <span className="text-muted-foreground/70">—</span>;
  const cell = "px-3 py-2 text-center tabular-nums";
  return (
    <tr
      className={cn(
        "border-b border-brand-border/60 last:border-0 odd:bg-brand-soft/50 hover:bg-brand-light/60",
        emphasis && "border-t-2 border-t-brand bg-brand-light font-semibold text-foreground",
        w.isCurrent && !emphasis && "bg-brand-light/70",
      )}
    >
      <td className="whitespace-nowrap px-3 py-2">
        <span className="font-medium">{w.label}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">
          {formatDay(w.start)} – {formatDay(w.end)}
        </span>
      </td>
      <td className={cn(cell, GROUP_BORDER)}>{o ? o.totalUnits : (totalUnits ?? "—")}</td>
      <td className={cell}>{occupied ?? na}</td>
      <td className={cell}>{b ?? "—"}</td>
      <td className={cn(cell, variance != null && (variance >= 0 ? "text-success" : "text-destructive"))}>
        {variance == null ? (occupied == null ? na : "—") : variance > 0 ? `+${variance}` : variance}
      </td>
      <td className={cell}>
        {occupied != null && o?.censusUnits ? `${((occupied / o.censusUnits) * 100).toFixed(1)}%` : na}
      </td>
      <td className={cell}>{occupied == null ? na : b ? `${((occupied / b) * 100).toFixed(1)}%` : "—"}</td>
      {careTypes.map((ct) => {
        const row = o?.byCareType.find((c) => c.careType === ct);
        return (
          <td key={ct} className={cell}>
            {row ? `${row.occupied}/${row.units}` : na}
          </td>
        );
      })}
      <td className={cn(cell, GROUP_BORDER)}>{w.moveIns}</td>
      <td className={cell}>{w.moveOuts}</td>
      <td className={cell}>{w.net > 0 ? `+${w.net}` : w.net}</td>
      <td className={cn(cell, GROUP_BORDER)}>{w.pendingIn}</td>
      <td className={cell}>{w.pendingOut}</td>
      <td className={cell}>{w.pendingNet > 0 ? `+${w.pendingNet}` : w.pendingNet}</td>
      <td className={cn(cell, GROUP_BORDER)}>{w.inquiries}</td>
      <td className={cell}>{w.outreach}</td>
      <td className={cell}>{w.tours}</td>
      <td className={cell}>{w.reTours}</td>
    </tr>
  );
}


/* -------------------------------------------------------------- */
/* Manual note cell                                                 */
/* -------------------------------------------------------------- */

function NoteCell({
  organizationId,
  communityId,
  subjectType,
  subjectKey,
  month,
  weekStart,
  notes,
  placeholder = "Weekly update",
}: {
  organizationId: string | null;
  communityId: string | null;
  subjectType: string;
  subjectKey: string;
  month: string;
  weekStart: string;
  notes: Record<string, any>;
  placeholder?: string;
}) {
  const existing = notes[`${subjectType}:${subjectKey}`];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(existing?.body ?? "");
  const save = useSaveFlashNote(organizationId);

  if (!communityId) return <span className="text-muted-foreground">—</span>;

  if (!editing) {
    return (
      <button
        type="button"
        className="flex max-w-[220px] items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground no-print"
        onClick={() => {
          setValue(existing?.body ?? "");
          setEditing(true);
        }}
      >
        <span className="truncate">{existing?.body || placeholder}</span>
        <Pencil className="size-3 shrink-0 opacity-60" />
      </button>
    );
  }

  return (
    <div className="flex items-start gap-1">
      <Textarea
        className="min-h-[60px] w-[220px] text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={save.isPending}
        onClick={async () => {
          await save.mutateAsync({
            id: existing?.id,
            community_id: communityId,
            subject_type: subjectType,
            subject_key: subjectKey,
            body: value,
            reporting_month: month,
            reporting_week_start: weekStart,
          });
          setEditing(false);
        }}
      >
        Save
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- */
/* Manual networking / event entries                                */
/* -------------------------------------------------------------- */

function DeleteEntryButton({ id }: { id: string }) {
  const del = useDeleteFlashEntry();
  return (
    <Button
      size="icon"
      variant="ghost"
      className="no-print"
      disabled={del.isPending}
      onClick={() => del.mutate(id)}
      aria-label="Delete entry"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

function EntryEditor({
  organizationId,
  communityIds,
  communityNames,
  month,
  weekStart,
}: {
  organizationId: string | null;
  communityIds: string[];
  communityNames: Record<string, string>;
  month: string;
  weekStart: string;
}) {
  const [open, setOpen] = useState(false);
  const save = useSaveFlashEntry(organizationId);
  const [form, setForm] = useState({
    community_id: communityIds[0] ?? "",
    entry_date: todayISO(),
    kind: "networking",
    title: "",
    target_audience: "",
    invited_count: "",
    attended_count: "",
    notes: "",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="no-print">
          <Plus className="size-4" /> Add Flash entry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add manual Flash entry</DialogTitle>
          <DialogDescription>
            Referral visits, networking, special events and other Flash notes. Manual entries are labelled
            as such and never counted as Outreach Contacts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Community</Label>
            <Select
              value={form.community_id}
              onValueChange={(v) => setForm((f) => ({ ...f, community_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select community" />
              </SelectTrigger>
              <SelectContent>
                {communityIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {communityNames[id] ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["event", "networking", "referral", "outreach", "note", "other"].map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Title / detail</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Target audience</Label>
            <Input
              value={form.target_audience}
              onChange={(e) => setForm((f) => ({ ...f, target_audience: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Invited / visited</Label>
              <Input
                type="number"
                value={form.invited_count}
                onChange={(e) => setForm((f) => ({ ...f, invited_count: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Attended / completed</Label>
              <Input
                type="number"
                value={form.attended_count}
                onChange={(e) => setForm((f) => ({ ...f, attended_count: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!form.community_id || !form.title || save.isPending}
            onClick={async () => {
              await save.mutateAsync({
                community_id: form.community_id,
                entry_date: form.entry_date,
                kind: form.kind,
                title: form.title,
                target_audience: form.target_audience || null,
                invited_count: form.invited_count === "" ? null : Number(form.invited_count),
                attended_count: form.attended_count === "" ? null : Number(form.attended_count),
                notes: form.notes || null,
                reporting_month: month,
                reporting_week_start: weekStart,
              });
              setOpen(false);
            }}
          >
            Save entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- */
/* Occupancy budget settings                                        */
/* -------------------------------------------------------------- */

function BudgetTable({
  organizationId,
  communityNames,
}: {
  organizationId: string | null;
  communityNames: Record<string, string>;
}) {
  const budgets = useFlashBudgets(organizationId);
  const del = useDeleteFlashBudget();
  return (
    <DataTable
      loading={budgets.isLoading}
      rows={budgets.data ?? []}
      empty={<EmptyState title="No budgets set" description="Add a date-effective unit budget so variance and budget % can be calculated." />}
      columns={[
        { key: "c", header: "Community", render: (r) => communityNames[r.community_id] ?? r.community_id },
        { key: "s", header: "Effective from", render: (r) => r.effective_start },
        { key: "e", header: "Effective to", render: (r) => r.effective_end ?? "Open" },
        { key: "u", header: "Budget units", align: "right", render: (r) => num(r.budget_occupied_units) },
        { key: "p", header: "Budget %", align: "right", render: (r) => (r.budget_occupancy_pct == null ? "—" : `${r.budget_occupancy_pct}%`) },
        { key: "n", header: "Notes", render: (r) => r.notes ?? "—" },
        {
          key: "d",
          header: "",
          render: (r) => (
            <Button size="icon" variant="ghost" className="no-print" onClick={() => del.mutate(r.id)} aria-label="Delete budget">
              <Trash2 className="size-4" />
            </Button>
          ),
        },
      ] as Column<any>[]}
    />
  );
}

function BudgetDialog({
  organizationId,
  communityIds,
  communityNames,
}: {
  organizationId: string | null;
  communityIds: string[];
  communityNames: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const save = useSaveFlashBudget(organizationId);
  const [form, setForm] = useState({
    community_id: communityIds[0] ?? "",
    effective_start: monthStart(todayISO()),
    effective_end: "",
    budget_occupied_units: "",
    budget_occupancy_pct: "",
    notes: "",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> Add budget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Occupancy / unit budget goal</DialogTitle>
          <DialogDescription>
            Set an occupied-unit target (and optionally a percentage target) that applies from a given date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Community</Label>
            <Select value={form.community_id} onValueChange={(v) => setForm((f) => ({ ...f, community_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select community" />
              </SelectTrigger>
              <SelectContent>
                {communityIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {communityNames[id] ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Effective start</Label>
              <Input type="date" value={form.effective_start} onChange={(e) => setForm((f) => ({ ...f, effective_start: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Effective end (optional)</Label>
              <Input type="date" value={form.effective_end} onChange={(e) => setForm((f) => ({ ...f, effective_end: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Budget occupied units</Label>
              <Input type="number" value={form.budget_occupied_units} onChange={(e) => setForm((f) => ({ ...f, budget_occupied_units: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Budget occupancy %</Label>
              <Input type="number" value={form.budget_occupancy_pct} onChange={(e) => setForm((f) => ({ ...f, budget_occupancy_pct: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !form.community_id ||
              (form.budget_occupied_units === "" && form.budget_occupancy_pct === "") ||
              save.isPending
            }
            onClick={async () => {
              await save.mutateAsync({
                community_id: form.community_id,
                effective_start: form.effective_start,
                effective_end: form.effective_end || null,
                budget_occupied_units:
                  form.budget_occupied_units === "" ? null : Number(form.budget_occupied_units),
                budget_occupancy_pct:
                  form.budget_occupancy_pct === "" ? null : Number(form.budget_occupancy_pct),
                notes: form.notes || null,
              });
              setOpen(false);
            }}
          >
            Save budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { FlashReport };
