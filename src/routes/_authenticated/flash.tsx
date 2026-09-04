import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Download, Info, Pencil, Plus, Printer, Trash2 } from "lucide-react";
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
  useDeleteFlashEntry,
  useFlashDeposits,
  useFlashEntries,
  useFlashHotLeads,
  useFlashMoveIns,
  useFlashMoveOuts,
  useFlashNotices,
  useFlashNotes,
  useFlashReport,
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
      { title: "Flash Report — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "The Sunday–Saturday operational Flash: occupancy versus budget, move-ins and move-outs, weekly sales activity and the monthly trackers leadership already knows.",
      },
      { property: "og:title", content: "Flash Report — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Automated Sunday–Saturday Flash reporting built on validated WelcomeHome metrics.",
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
const signed = (n: number | null | undefined) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));
const tone = (n: number | null | undefined): "up" | "down" | "neutral" =>
  n == null ? "neutral" : n > 0 ? "up" : n < 0 ? "down" : "neutral";

const pct1 = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Neutral fallback so raw reference ids never surface as a person's name. */
function personName(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t.length ? t : "Name unavailable";
}

/** Short absolute date, e.g. "Aug 28" (adds year when outside the current year). */
function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Human-readable relative day for recent/near dates; falls back to a short date. */
function relativeDay(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (days < 0 && days >= -13) return `${-days} days ago`;
  if (days > 0 && days <= 13) return `In ${days} days`;
  return shortDate(v);
}

/** Full timestamp preserved for tooltips / audit. */
const fullStamp = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "");

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
      "MIs", "MOs", "NET", "Scheduled Move Ins", "Scheduled Outs", "Scheduled NET",
      "Projected EOM MIs", "Projected EOM MOs", "Projected EOM NET",
      "Projected Occ #", "Projected Occ %",
      "Inquiries", "Outreach Contacts", "Tours", "Re-Tours",
    ];
    const so = data?.starting?.occupancy ?? null;
    const sb = data?.starting?.budget?.units ?? null;
    const sVar = so?.occupiedUnits != null && sb != null ? so.occupiedUnits - sb : null;
    const starting = [
      "Starting #",
      data?.starting?.asOfDate ?? "",
      ...(so
        ? [
            so.censusUnits,
            so.occupiedUnits,
            sb ?? "—",
            sVar ?? "—",
            so.censusUnits ? ((so.occupiedUnits / so.censusUnits) * 100).toFixed(1) : "—",
            sb ? ((so.occupiedUnits / sb) * 100).toFixed(1) : "—",
            ...careTypes.map((ct) => {
              const row = so.byCareType.find((c) => c.careType === ct);
              return row ? `${row.occupied}/${row.units}` : "—";
            }),
          ]
        : Array(6 + careTypes.length).fill("—")),
      ...Array(15).fill(""),
    ];
    const rowsOut = [...(data?.weeks ?? []), ...(data ? [data.month] : [])].map((w) =>
      gridRow(w, occ?.censusUnits ?? null, careTypes),
    );
    // Trackers are exported with the same server-resolved labels shown on screen.
    const trackerRows: (string | number | null | undefined)[][] = [
      [],
      ["Move-In Monthly Tracker"],
      ["Resident", "Move-In Date", "Care Type", "Unit", "Monthly Rate"],
      ...(moveIns.data?.rows ?? []).map((r: any) => [
        personName(r.person_name), r.move_in_date, r.care_type ?? "Unspecified", r.unit_label ?? "", r.monthly_rate ?? "",
      ]),
      [],
      ["Deposit Monthly Tracker (provisional)"],
      ["Depositor", "Deposit Date", "Amount", "Expected MI", "Care Type", "Unit"],
      ...(deposits.data?.rows ?? []).map((r: any) => [
        personName(r.person_name), r.deposit_date, r.amount ?? "", r.expected_move_in_date ?? "",
        r.care_type ?? "Unspecified", r.unit_label ?? "",
      ]),
      [],
      ["Move-Out Monthly Tracker"],
      ["Resident", "Move-Out Date", "Care Type", "Unit", "Reason"],
      ...(moveOuts.data?.rows ?? []).map((r: any) => [
        personName(r.person_name), r.move_out_date, r.care_type ?? "Unspecified", r.unit_label ?? "", r.reason ?? "",
      ]),
      [],
      ["Hot Lead Tracker (current state)"],
      ["Prospect", "Stage", "Inquiry Date", "Lead Source", "Sales Counselor", "Last Contact", "Next Activity", "Next Activity Date"],
      ...(hotLeads.data?.rows ?? []).map((r: any) => [
        personName(r.person_name),
        resolveLabel(labels.stage, r.stage_id, r.stage_label ?? ""),
        r.inquiry_date ?? "",
        r.lead_source_label ?? resolveLabel(labels.leadSource, r.lead_source_id, ""),
        r.counselor_name ?? resolveLabel(labels.user, r.counselor_id, ""),
        r.last_contact_at ? new Date(r.last_contact_at).toISOString().slice(0, 10) : "",
        r.next_activity_type ?? "",
        r.next_activity_scheduled_at ? new Date(r.next_activity_scheduled_at).toISOString().slice(0, 10) : "",
      ]),
    ];
    downloadCsv(`flash-${formatMonth(month).replace(" ", "-").toLowerCase()}.csv`, [
      header, starting, ...rowsOut, ...trackerRows,
    ]);
  };


  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Flash context…</p>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operational reporting"
        title="Flash Report"
        description="Sunday–Saturday operational Flash. Automated from validated WelcomeHome metrics, with manual Flash fields where the source has no equivalent."
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
            <Label className="text-[11px] text-muted-foreground">Week starting (Sunday)</Label>
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
          <p>{scopeLabel}</p>
        </div>
      </div>

      {report.error ? (
        <EmptyState
          title="Flash report unavailable"
          description={(report.error as Error).message}
        />
      ) : null}

      {/* 1. MONTHLY WEEK-BY-WEEK GRID — the primary operational Flash view */}
      <Section
        title={`${formatMonth(month)} — Week by Week`}
        description={
          data?.month.isMonthClosed === false
            ? "Sunday–Saturday weeks ending inside the month, plus a month-to-date row. Finalized month-end occupancy appears once the month closes."
            : "Sunday–Saturday weeks ending inside the month, plus month end."
        }
      >
        <WeekByWeekGrid data={data} loading={report.isLoading} occ={occ} />
        <p className="pt-2 text-[11px] text-muted-foreground">
          Completed weeks show occupancy from that week's immutable daily snapshot; the in-progress week shows
          current state. Dates before nightly snapshots began are shown as “—” and are never filled with
          current-state data.
        </p>
      </Section>

      {/* 2. COMPACT CURRENT SUMMARY — deliberately dense so the week-by-week
           grid above stays the centerpiece of the page. */}
      <Section
        title="Current summary"
        badge={<CurrentStateBadge />}
        description="Occupancy reflects current WelcomeHome contract and unit state as of today. Completed weeks read their occupancy from that week's immutable daily snapshot. Move-ins, move-outs and sales activity are for the selected Flash week."
      >
        <CurrentSummaryPanel
          occ={occ}
          occupied={occupied}
          census={census}
          budgetUnits={budgetUnits}
          variance={variance}
          occPct={occPct}
          budgetPct={budgetPct}
          monthLabel={formatMonth(month)}
          monthPeriod={data?.month ?? null}
          weekPeriod={data?.week ?? null}
          isOrgAdmin={isOrgAdmin}
        />
        {data?.month.projectedOverCapacity ? (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Data Health warning — projected month-end occupied units
            ({data.month.projectedOccupiedUnits}) exceed canonical census capacity
            ({data.month.projectedCensusUnits}). Pending contract dates or unit census flags need
            review in WelcomeHome. The calculation has not been adjusted.
          </p>
        ) : null}
        {data?.month.projectedOverCapacity ? (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Data Health warning — projected month-end occupied units
            ({data.month.projectedOccupiedUnits}) exceed canonical census capacity
            ({data.month.projectedCensusUnits}). Pending contract dates or unit census flags need
            review in WelcomeHome. The calculation has not been adjusted.
          </p>
        ) : null}
      </Section>


      {/* 6. NEXT MONTH SCHEDULED MIMO */}
      <Section
        title={`Next month scheduled MIMO (${formatMonth(nmStart)})`}
        badge={<CurrentStateBadge />}
        description="WelcomeHome-confirmed future-dated contract state for next month."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Scheduled move-ins" value={num(data?.nextMonth.pendingIn)} />
          <Stat label="Scheduled move-outs / notices" value={num(data?.nextMonth.pendingOut)} />
          <Stat label="Net" value={data ? String(data.nextMonth.pendingNet) : "—"} />
        </div>
      </Section>

      {/* Monthly trackers — Move-In + Deposit share one row; Hot Lead spans full width below. */}
      <Section
        title="Monthly trackers"
        description="Compact operational view. Full detail remains available through Sales Intelligence drill-through."
      >
        {/* First row: Move-In (50%) + Deposit (50%) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      <td className="max-w-[160px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.move_in_date)}</td>
                      <td className="max-w-[140px] truncate px-3 py-1.5 text-muted-foreground">
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
                    <th className="hidden px-3 py-1.5 text-left font-medium lg:table-cell">Care / Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {(deposits.data?.rows ?? []).map((r: any) => (
                    <tr key={r.source_id} className="border-t border-brand-border/50">
                      <td className="max-w-[150px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.deposit_date)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{formatDay(r.expected_move_in_date)}</td>
                      <td className="hidden max-w-[150px] truncate px-3 py-1.5 text-muted-foreground lg:table-cell">
                        {r.care_type ?? "—"} · {r.unit_label ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TrackerCard>
        </div>

        {/* Second row: Hot Lead tracker — full content width.
            Current-state working list: every open prospect currently scored Hot,
            regardless of inquiry date or the selected Flash week/month. */}
        <TrackerCard
          title={`Hot Lead Tracker (${hotLeads.data?.total ?? 0})`}
          badge={<CurrentStateBadge />}
          loading={hotLeads.isLoading}
        >
          {(hotLeads.data?.rows ?? []).length === 0 && !hotLeads.isLoading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No open prospects mapped to the Hot score.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="thead-brand text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-1.5 text-left font-medium">Prospect</th>
                    <th className="px-3 py-1.5 text-left font-medium">Stage</th>
                    <th className="px-3 py-1.5 text-left font-medium">Inquiry Date</th>
                    <th className="px-3 py-1.5 text-left font-medium">Lead Source</th>
                    <th className="px-3 py-1.5 text-left font-medium">Sales Counselor</th>
                    <th className="px-3 py-1.5 text-left font-medium">Last Contact</th>
                    <th className="px-3 py-1.5 text-left font-medium">Next Activity</th>
                    <th className="px-3 py-1.5 text-left font-medium">Next Activity Date</th>
                    <th className="px-3 py-1.5 text-left font-medium">Weekly Update</th>
                  </tr>
                </thead>
                <tbody>
                  {(hotLeads.data?.rows ?? []).map((r: any) => (
                    <tr key={r.source_id} className="border-t border-brand-border/50 align-top">
                      <td className="max-w-[200px] truncate px-3 py-1.5 font-medium">{personName(r.person_name)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {resolveLabel(labels.stage, r.stage_id, r.stage_label ?? "Unknown stage")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.inquiry_date)}</td>
                      <td className="max-w-[150px] truncate px-3 py-1.5 text-muted-foreground">
                        {r.lead_source_label ?? resolveLabel(labels.leadSource, r.lead_source_id, "Source n/a")}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-1.5 text-muted-foreground">
                        {r.counselor_name ?? resolveLabel(labels.user, r.counselor_id, "Counselor n/a")}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
                        title={fullStamp(r.last_contact_at)}
                      >
                        {relativeDay(r.last_contact_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {r.next_activity_type ?? "—"}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
                        title={fullStamp(r.next_activity_scheduled_at)}
                      >
                        {r.next_activity_scheduled_at
                          ? `${shortDate(r.next_activity_scheduled_at)} · ${relativeDay(r.next_activity_scheduled_at)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <NoteCell
                          organizationId={organizationId}
                          communityId={r.community_id}
                          subjectType="hot_lead"
                          subjectKey={r.source_id}
                          month={mStart}
                          weekStart={week.start}
                          notes={notes.data ?? {}}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TrackerCard>
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
  hint,
  items,
  prominent,
}: {
  heading: string;
  hint?: string;
  items: { label: string; value: React.ReactNode; tone?: "neutral" | "up" | "down"; group?: boolean }[];
  prominent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3",
        prominent && "bg-brand-soft/80 ring-1 ring-inset ring-brand-border",
      )}
    >
      <div className="w-full md:w-48 md:shrink-0">
        <p
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-brand",
            prominent && "text-brand-dark",
          )}
        >
          {heading}
        </p>
        {hint ? <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        {items.map((it) => (
          <div
            key={it.label}
            className={cn(
              "min-w-[60px] space-y-0.5 text-center",
              it.group && "rounded-md border border-brand-border/70 bg-brand-soft/60 px-3 py-1",
            )}
          >
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

/* ------------------------------------------------------------------ */
/* Redesigned Current Summary panel                                    */
/* ------------------------------------------------------------------ */
/*
 * One cohesive panel split into three visual groups — Current Occupancy,
 * the month MIMO progression (MTD Actual → Scheduled Remaining → Projected
 * EOM), and Projected Month-End Occupancy — with the Weekly Sales Update as a
 * secondary full-width footer. No calculations change; this is a
 * presentation reorganisation of the same server-side values.
 */

function MimoStage({
  label,
  mi,
  mo,
  net,
  netTone,
  prominent,
}: {
  label: string;
  mi: React.ReactNode;
  mo: React.ReactNode;
  net: React.ReactNode;
  netTone: "neutral" | "up" | "down";
  prominent?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[104px] rounded-md px-3 py-2 text-center",
        prominent
          ? "bg-brand-light ring-1 ring-inset ring-brand-border"
          : "bg-surface/70 ring-1 ring-inset ring-border/70",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-display font-semibold leading-tight tabular-nums",
          prominent ? "text-2xl" : "text-xl",
        )}
      >
        <span className="text-brand">{mi}</span>
        <span className="text-muted-foreground/50"> / </span>
        <span className="text-brand">{mo}</span>
        <span className="text-muted-foreground/50"> / </span>
        <span
          className={cn(
            netTone === "up" && "text-success",
            netTone === "down" && "text-destructive",
            netTone === "neutral" && "text-brand-dark",
          )}
        >
          {net}
        </span>
      </p>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-display text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function CurrentSummaryPanel({
  occ,
  occupied,
  census,
  budgetUnits,
  variance,
  occPct,
  budgetPct,
  monthLabel,
  monthPeriod,
  weekPeriod,
  isOrgAdmin,
}: {
  occ: FlashReport["occupancy"] | null;
  occupied: number | null;
  census: number | null;
  budgetUnits: number | null;
  variance: number | null;
  occPct: number | null;
  budgetPct: number | null;
  monthLabel: string;
  monthPeriod: FlashPeriod | null;
  weekPeriod: FlashPeriod | null;
  isOrgAdmin: boolean;
}) {
  const mtdMi = num(monthPeriod?.moveIns ?? null);
  const mtdMo = num(monthPeriod?.moveOuts ?? null);
  const mtdNet = signed(monthPeriod?.net ?? null);
  const mtdNetTone = tone(monthPeriod?.net ?? null);

  const schMi = num(monthPeriod?.pendingIn ?? null);
  const schMo = num(monthPeriod?.pendingOut ?? null);
  const schNet = signed(monthPeriod?.pendingNet ?? null);
  const schNetTone = tone(monthPeriod?.pendingNet ?? null);

  const eomMi = num(projectedEomMi(monthPeriod));
  const eomMo = num(projectedEomMo(monthPeriod));
  const eomNet = signed(projectedEomNet(monthPeriod));
  const eomNetTone = tone(projectedEomNet(monthPeriod));

  const projOcc = monthPeriod?.projectedOccupiedUnits ?? null;
  const projPct =
    monthPeriod?.projectedOccupancyPct == null
      ? null
      : Number(monthPeriod.projectedOccupancyPct);

  const careTypes =
    occ && occ.byCareType.length > 1
      ? occ.byCareType.map((c) => `${c.occupied}/${c.units}`).join("  ·  ")
      : null;

  return (
    <div className="panel-brand overflow-hidden">
      <div className="grid grid-cols-1 divide-y divide-brand-border/70 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:divide-y-0 lg:divide-x">
        {/* A. Current Occupancy */}
        <div className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">Current occupancy</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tracking-tight text-brand">
              {num(occupied)}
              <span className="text-muted-foreground/50"> / {num(census)}</span>
            </span>
            <span className="text-sm font-medium text-muted-foreground">occupied</span>
          </div>
          <p className="mt-1 font-display text-xl font-semibold text-brand-dark">
            {pct1(occPct)}
            <span className="ml-1 text-xs font-medium text-muted-foreground">OCC</span>
          </p>

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">Budget</span>{" "}
            {budgetUnits == null ? (
              <span className="text-xs font-medium text-muted-foreground">not set</span>
            ) : (
              num(budgetUnits)
            )}
            {"  ·  "}
            <span className="font-medium uppercase tracking-wide">Variance</span>{" "}
            {variance == null ? "—" : variance > 0 ? `+${variance}` : String(variance)}
            {"  ·  "}
            <span className="font-medium uppercase tracking-wide">Budget %</span> {pct1(budgetPct)}
            {"  ·  "}
            <span className="font-medium uppercase tracking-wide">On notice</span>{" "}
            {num(occ?.noticeCount ?? null)}
          </p>

          {budgetUnits == null && isOrgAdmin ? (
            <Link
              to="/admin/communities"
              className="no-print mt-2 inline-block text-[10px] font-medium uppercase tracking-wide text-brand underline underline-offset-2 hover:text-brand-dark"
            >
              Edit community budget
            </Link>
          ) : null}
          {careTypes ? (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {occ!.byCareType.map((c) => `${c.careType} ${c.occupied}/${c.units}`).join("  ·  ")}
            </p>
          ) : null}
        </div>

        {/* B. MIMO progression */}
        <div className="bg-brand-soft/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">
            {monthLabel} MIMO
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MimoStage label="MTD actual" mi={mtdMi} mo={mtdMo} net={mtdNet} netTone={mtdNetTone} />
            <ArrowRight className="size-4 shrink-0 text-muted-foreground/60" />
            <MimoStage
              label="Scheduled remaining"
              mi={schMi}
              mo={schMo}
              net={schNet}
              netTone={schNetTone}
            />
            <ArrowRight className="size-4 shrink-0 text-muted-foreground/60" />
            <MimoStage
              label="Projected EOM"
              mi={eomMi}
              mo={eomMo}
              net={eomNet}
              netTone={eomNetTone}
              prominent
            />
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Projected EOM combines month-to-date actuals with confirmed remaining move-ins and
            move-outs.
          </p>
        </div>

        {/* C. Projected month-end occupancy */}
        <div className="bg-brand-dark/[0.06] p-4 ring-1 ring-inset ring-brand-border/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">
            Projected month-end
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tracking-tight text-brand">
              {num(projOcc)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">occupied</span>
          </div>
          <p className="mt-1 font-display text-xl font-bold text-brand-dark">
            {projPct == null ? "—" : `${projPct.toFixed(1)}%`}
            <span className="ml-1 text-xs font-medium text-muted-foreground">projected OCC</span>
          </p>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Based on MTD actuals plus confirmed remaining move-ins and move-outs.
          </p>
        </div>
      </div>

      {/* Weekly sales update — secondary, full-width footer */}
      <div className="border-t border-brand-border/70 bg-brand-soft/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">
            Weekly sales update
          </p>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
            <SecondaryStat label="Inquiries" value={num(weekPeriod?.inquiries ?? null)} />
            <SecondaryStat
              label="Outreach"
              value={
                weekPeriod?.outreachMapped === false ? "Not mapped" : num(weekPeriod?.outreach ?? null)
              }
            />
            <SecondaryStat label="Tours" value={num(weekPeriod?.tours ?? null)} />
            <SecondaryStat label="Re-Tours" value={num(weekPeriod?.reTours ?? null)} />
          </div>
        </div>
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

/**
 * Projected end-of-month MIMO = actual completed events for the period plus
 * WelcomeHome-confirmed scheduled (future-dated) contracts for the same
 * period. No validated MI/MO definition is altered — this is a presentation
 * rollup over two already-canonical server values, and the same helpers feed
 * the screen, the CSV export and the print/PDF view.
 */
function projectedEomMi(p: FlashPeriod | null | undefined): number | null {
  if (!p || (p.moveIns == null && p.pendingIn == null)) return null;
  return (p.moveIns ?? 0) + (p.pendingIn ?? 0);
}

function projectedEomMo(p: FlashPeriod | null | undefined): number | null {
  if (!p || (p.moveOuts == null && p.pendingOut == null)) return null;
  return (p.moveOuts ?? 0) + (p.pendingOut ?? 0);
}

function projectedEomNet(p: FlashPeriod | null | undefined): number | null {
  const mi = projectedEomMi(p);
  const mo = projectedEomMo(p);
  if (mi == null && mo == null) return null;
  return (mi ?? 0) - (mo ?? 0);
}

function gridRow(w: FlashPeriod, censusUnits: number | null, careTypes: string[]) {
  const o = w.occupancy ?? null;
  const b = w.budget?.units ?? null;
  const occupied = o?.occupiedUnits ?? null;
  const variance = occupied != null && b != null ? occupied - b : null;
  return [
    w.label,
    `${w.start} → ${w.end}`,
    o ? o.censusUnits : (censusUnits ?? ""),
    occupied ?? "—",
    b ?? "",
    variance ?? "",
    occupied != null && o?.censusUnits ? ((occupied / o.censusUnits) * 100).toFixed(1) : "",
    occupied != null && b ? ((occupied / b) * 100).toFixed(1) : "",
    ...careTypes.map((ct) => {
      const row = o?.byCareType.find((c) => c.careType === ct);
      return row ? `${row.occupied}/${row.units}` : "—";
    }),
    w.moveIns ?? "—",
    w.moveOuts ?? "—",
    w.net ?? "—",
    w.pendingIn ?? "—",
    w.pendingOut ?? "—",
    w.pendingNet ?? "—",
    projectedEomMi(w) ?? "—",
    projectedEomMo(w) ?? "—",
    projectedEomNet(w) ?? "—",
    w.projectedOccupiedUnits ?? "—",
    w.projectedOccupancyPct == null ? "—" : Number(w.projectedOccupancyPct).toFixed(1),

    w.inquiries ?? "—",
    w.outreach ?? "—",
    w.tours ?? "—",
    w.reTours ?? "—",

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
    { label: "Current MIMO (actual)", cols: ["MIs", "MOs", "NET"] },
    {
      label: "This month — scheduled MIMO",
      cols: ["Scheduled Move-Ins", "Scheduled Move-Outs", "Net"],
    },
    {
      label: "This month — projected month-end",
      cols: ["Proj EOM MIs", "Proj EOM MOs", "Proj EOM Net", "Projected OCC #", "Projected OCC %"],
    },
    { label: "Weekly sales update", cols: ["Inquiries", "Outreach Contacts", "Tours", "Re-Tours"] },
  ];
  const totalCols = 1 + groups.reduce((n, g) => n + g.cols.length, 0);

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          {/* Grouped legacy heading row — visually dominant */}
          <tr className="thead-brand-strong text-[11px] font-semibold uppercase tracking-wider">
            <th className="sticky left-0 z-[4] bg-brand-dark whitespace-nowrap border-r border-white/25 px-3 py-2 text-left">
              Week / Date
            </th>
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
            <th className="sticky left-0 z-[4] bg-brand-light px-3 py-1.5 text-left font-medium" />
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
          <StartingRow careTypes={careTypes} totalCols={totalCols} starting={data?.starting ?? null} />
          {(data?.weeks ?? []).map((w, i) => (
            <GridRow key={w.start} w={w} censusUnits={occ?.censusUnits ?? null} careTypes={careTypes} index={i} />
          ))}
          {data ? (
            <GridRow w={data.month} censusUnits={occ?.censusUnits ?? null} careTypes={careTypes} emphasis />
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

/**
 * Legacy "Starting #" row: the occupancy position going into the month, read
 * from the last immutable daily snapshot before the first reporting week.
 * When no snapshot exists for that date the cells stay "—" — the position is
 * never reconstructed from today's current state.
 */
function StartingRow({
  careTypes,
  totalCols,
  starting,
}: {
  careTypes: string[];
  totalCols: number;
  starting: FlashReport["starting"] | null | undefined;
}) {
  const occCols = 6 + careTypes.length;
  const o = starting?.occupancy ?? null;
  const b = starting?.budget?.units ?? null;
  const occupied = o?.occupiedUnits ?? null;
  const variance = occupied != null && b != null ? occupied - b : null;
  const cells: (string | number)[] = o
    ? [
        o.censusUnits,
        occupied ?? "—",
        b ?? "—",
        variance == null ? "—" : variance > 0 ? `+${variance}` : variance,
        occupied != null && o.censusUnits ? `${((occupied / o.censusUnits) * 100).toFixed(1)}%` : "—",
        occupied != null && b ? `${((occupied / b) * 100).toFixed(1)}%` : "—",
        ...careTypes.map((ct) => {
          const row = o.byCareType.find((c) => c.careType === ct);
          return row ? `${row.occupied}/${row.units}` : "—";
        }),
      ]
    : Array.from({ length: occCols }, () => "—");

  return (
    <tr className="border-b border-brand-border/70 bg-brand-soft text-muted-foreground">
      <td className="sticky left-0 z-[2] bg-brand-soft whitespace-nowrap border-r border-brand-border px-3 py-2 font-medium text-foreground">
        Starting #
        {starting?.asOfDate ? (
          <span className="ml-2 text-[11px] text-muted-foreground">
            {o ? `snapshot ${formatDay(o.snapshotDate ?? starting.asOfDate)}` : `as of ${formatDay(starting.asOfDate)}`}
          </span>
        ) : null}
      </td>
      {cells.map((v, i) => (
        <td key={`s-occ-${i}`} className={cn("px-3 py-2 text-center tabular-nums", i === 0 && GROUP_BORDER)}>
          {v}
        </td>
      ))}
      {Array.from({ length: totalCols - 1 - occCols }).map((_, i) => (
        <td
          key={`s-rest-${i}`}
          className={cn(
            "px-3 py-2 text-center tabular-nums",
            // Group-start dividers mirror the grouped header: Current MIMO (0),
            // Scheduled MIMO (3), Projected Month-End (6), Weekly Sales (11).
            (i === 0 || i === 3 || i === 6 || i === 11) && GROUP_BORDER,
          )}
        >
          —
        </td>
      ))}
    </tr>
  );
}

function GridRow({
  w,
  censusUnits,
  careTypes,
  emphasis,
  index = 0,
}: {
  w: FlashPeriod;
  censusUnits: number | null;
  careTypes: string[];
  emphasis?: boolean;
  index?: number;
}) {
  const o = w.occupancy ?? null;
  const b = w.budget?.units ?? null;
  const occupied = o?.occupiedUnits ?? null;
  const variance = occupied != null && b != null ? occupied - b : null;
  const na = <span className="text-muted-foreground/70">—</span>;
  const cell = "px-3 py-2 text-center tabular-nums";
  // Explicit solid background for the sticky first-column cell so scrolling
  // content never bleeds through. Matches the row tint (incl. hover/current).
  const stickyBg = emphasis
    ? "bg-brand-light"
    : w.isCurrent
      ? "bg-brand-light"
      : index % 2 === 1
        ? "bg-brand-soft hover:bg-brand-light"
        : "bg-surface hover:bg-brand-light";
  return (
    <tr
      className={cn(
        // Opaque row tints so the sticky first column does not bleed through
        // while horizontally scrolling.
        "border-b border-brand-border/60 last:border-0 odd:bg-brand-soft hover:bg-brand-light",
        emphasis && "border-t-2 border-t-brand bg-brand-light font-semibold text-foreground",
        w.isCurrent && !emphasis && "bg-brand-light",
      )}
    >
      <td className={cn("sticky left-0 z-[3] whitespace-nowrap border-r border-brand-border px-3 py-2", stickyBg)}>
        <span className="font-medium">{w.label}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">
          {formatDay(w.start)} – {formatDay(w.end)}
        </span>
      </td>
      <td className={cn(cell, GROUP_BORDER)}>{o ? o.censusUnits : (censusUnits ?? "—")}</td>
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
      <td className={cn(cell, GROUP_BORDER)}>{w.moveIns ?? na}</td>
      <td className={cell}>{w.moveOuts ?? na}</td>
      <td className={cell}>{w.net == null ? na : signed(w.net)}</td>
      <td className={cn(cell, GROUP_BORDER)}>{w.pendingIn ?? na}</td>
      <td className={cell}>{w.pendingOut ?? na}</td>
      <td className={cell}>{w.pendingNet == null ? na : signed(w.pendingNet)}</td>
      <td className={cn(cell, GROUP_BORDER, "bg-brand-soft/25")}>{projectedEomMi(w) ?? na}</td>
      <td className={cn(cell, "bg-brand-soft/25")}>{projectedEomMo(w) ?? na}</td>
      <td className={cn(cell, "bg-brand-soft/25")}>
        {projectedEomNet(w) == null ? na : signed(projectedEomNet(w)!)}
      </td>
      <td className={cn(cell, "bg-brand-soft/40")}>{w.projectedOccupiedUnits ?? na}</td>
      <td className={cn(cell, "bg-brand-soft/40")}>
        {w.projectedOccupancyPct == null ? na : `${Number(w.projectedOccupancyPct).toFixed(1)}%`}
      </td>
      <td className={cn(cell, GROUP_BORDER)}>{w.inquiries ?? na}</td>
      <td className={cell}>{w.outreach ?? na}</td>
      <td className={cell}>{w.tours ?? na}</td>
      <td className={cell}>{w.reTours ?? na}</td>

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

export type { FlashReport };
