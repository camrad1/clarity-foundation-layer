import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Info, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/clarity/page-header";
import { EmptyState } from "@/components/clarity/empty-state";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommunities } from "@/lib/clarity-queries";
import {
  formatMonthLabel,
  formatShortDate,
  forecastDatesForMonth,
  isPastForecastWeek,
  monthEnd,
  monthStart,
  recentMonths,
  todayISO,
} from "@/lib/forecast/period";
import {
  useForecastEntries,
  useForecastActualsFinalized,
  useForecastEomActuals,
  useSaveForecast,
  type ForecastEntry,
} from "@/lib/forecast/queries";
import { cn } from "@/lib/utils";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";

/** Net sign formatting, kept consistent with weekly forecast cells: +N, -N, +0. */
function formatNet(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

export const Route = createFileRoute("/_authenticated/forecast")({
  head: () => ({
    meta: [
      { title: "Forecast Tracker — ClarityIQ" },
      {
        name: "description",
        content:
          "Weekly community move-in and move-out projections preserved as point-in-time records and compared with validated month-end results.",
      },
      { property: "og:title", content: "Forecast Tracker — ClarityIQ" },
      {
        property: "og:description",
        content: "Weekly community projections compared with final month-end results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForecastTracker,
});

type EditTarget = {
  communityId: string;
  communityName: string;
  forecastDate: string;
  entry: ForecastEntry | null;
};

function ForecastTracker() {
  const { organizationId, communityScope } = useAppState();
  const communities = useCommunities(organizationId);
  const [month, setMonth] = useState<string>(monthStart(todayISO()));

  const authorized = useMemo(
    () =>
      (communities.data ?? []).map((c: any) => ({
        id: c.id as string,
        region_id: (c.region_id as string | null) ?? null,
      })),
    [communities.data],
  );
  const selectedIds = useMemo(
    () => resolveSelectedCommunityIds(communityScope, authorized),
    [communityScope, authorized],
  );
  const rows = useMemo(
    () =>
      (communities.data ?? [])
        .filter((c: any) => selectedIds.includes(c.id))
        .map((c: any) => ({ id: c.id as string, name: c.name as string })),
    [communities.data, selectedIds],
  );

  const dates = useMemo(() => forecastDatesForMonth(month), [month]);
  const entries = useForecastEntries(organizationId, month);
  const actuals = useForecastEomActuals(organizationId, month, selectedIds);
  const finalized = useForecastActualsFinalized(organizationId, month);
  const save = useSaveForecast(month);
  const [edit, setEdit] = useState<EditTarget | null>(null);

  const byCell = useMemo(() => {
    const map = new Map<string, ForecastEntry>();
    for (const e of entries.data ?? []) map.set(`${e.community_id}|${e.forecast_date}`, e);
    return map;
  }, [entries.data]);

  /**
   * EOM Actual is a finalized full-month result. While the month is open — or
   * before the post-close WelcomeHome sync succeeds — the map stays empty so
   * every row and the TOTAL render “—” instead of month-to-date activity.
   */
  const actualsReleased = finalized.data === true;

  const actualByCommunity = useMemo(() => {
    const map = new Map<string, { move_ins: number; move_outs: number }>();
    if (!actualsReleased) return map;
    for (const a of actuals.data ?? []) map.set(a.community_id, a);
    return map;
  }, [actuals.data, actualsReleased]);

  const totals = useMemo(() => {
    const perDate = dates.map((d) => {
      let mi = 0;
      let mo = 0;
      let any = false;
      for (const r of rows) {
        const e = byCell.get(`${r.id}|${d}`);
        if (!e) continue;
        if (e.projected_move_ins === null && e.projected_move_outs === null) continue;
        any = true;
        mi += e.projected_move_ins ?? 0;
        mo += e.projected_move_outs ?? 0;
      }
      return { date: d, mi, mo, any };
    });
    let ami = 0;
    let amo = 0;
    for (const r of rows) {
      const a = actualByCommunity.get(r.id);
      ami += a?.move_ins ?? 0;
      amo += a?.move_outs ?? 0;
    }
    return { perDate, actual: { mi: ami, mo: amo } };
  }, [dates, rows, byCell, actualByCommunity]);

  const monthOptions = useMemo(() => recentMonths(24), []);
  const monthClosed = useMemo(() => monthEnd(month) < todayISO(), [month]);
  const finalDate = monthClosed && dates.length > 0 ? dates[dates.length - 1] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planning"
        title="Forecast Tracker"
        description="Weekly community projections compared with final month-end results."
        actions={
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No communities in scope"
          description="Adjust the community filter to see weekly projections."
        />
      ) : dates.length === 0 ? (
        <EmptyState title="No weekly forecast dates" description="This month has no forecast weeks." />
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="thead-brand">
                  <th className="sticky left-0 z-10 bg-brand-light px-3 py-2 text-left font-medium">
                    Community
                  </th>
                  {dates.map((d, i) => {
                    const isFinal = finalDate === d && i === dates.length - 1;
                    return (
                      <th
                        key={d}
                        className={cn(
                          "px-3 py-2 text-center font-medium whitespace-nowrap",
                          isFinal && "border-l-2 border-brand-border bg-brand-soft/50",
                        )}
                      >
                        {formatShortDate(d)}
                        {isFinal ? (
                          <span className="mt-0.5 block text-[0.6rem] font-normal uppercase tracking-wide text-muted-foreground">
                            Final
                          </span>
                        ) : null}
                      </th>
                    );
                  })}
                  <th className="border-l-2 border-brand-dark bg-brand px-3 py-2 text-center font-semibold whitespace-nowrap text-brand-foreground">
                    {actualsReleased ? (
                      "EOM Actual"
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dotted border-brand-foreground/50">
                            EOM Actual
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Final actuals available after month close and successful WelcomeHome sync.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const actual = actualByCommunity.get(r.id);
                  return (
                    <tr key={r.id} className="border-t border-border odd:bg-brand-soft/60">
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 font-medium whitespace-nowrap">
                        {r.name}
                      </td>
                      {dates.map((d) => {
                        const e = byCell.get(`${r.id}|${d}`) ?? null;
                        const has = e && (e.projected_move_ins !== null || e.projected_move_outs !== null);
                        const net = (e?.projected_move_ins ?? 0) - (e?.projected_move_outs ?? 0);
                        const isFinal = finalDate === d;
                        return (
                          <td
                            key={d}
                            className={cn(
                              "px-1 py-1 text-center",
                              isFinal && "border-l-2 border-brand-border bg-brand-soft/40",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setEdit({
                                  communityId: r.id,
                                  communityName: r.name,
                                  forecastDate: d,
                                  entry: e,
                                })
                              }
                              className="group inline-flex min-w-[64px] items-center justify-center gap-1 rounded px-2 py-1 tabular-nums hover:bg-brand-light"
                            >
                              {has ? (
                                <span className="font-medium">
                                  {e!.projected_move_ins ?? 0} / {e!.projected_move_outs ?? 0}
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    ({formatNet(net)})
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              {e?.historical_source_note ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="size-3 text-brand" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    {e.historical_source_note}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                              <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                            </button>
                          </td>
                        );
                      })}
                      <td className="border-l-2 border-brand-border px-3 py-1.5 text-center tabular-nums font-semibold">
                        {actual
                          ? `${actual.move_ins} / ${actual.move_outs} (${formatNet(actual.move_ins - actual.move_outs)})`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-[3px] border-brand bg-brand-light/70 font-bold">
                  <td className="sticky left-0 z-10 bg-brand-light px-3 py-2 text-sm uppercase tracking-wide">
                    Total
                  </td>
                  {totals.perDate.map((t) => {
                    const isFinal = finalDate === t.date;
                    return (
                      <td
                        key={t.date}
                        className={cn(
                          "px-3 py-2 text-center text-sm tabular-nums",
                          isFinal && "border-l-2 border-brand-border bg-brand-soft/40",
                        )}
                      >
                        {t.any ? (
                          <>
                            {t.mi} / {t.mo}
                            <span className="ml-1 text-xs font-semibold text-muted-foreground">
                              ({formatNet(t.mi - t.mo)})
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                  <td className="border-l-2 border-brand-dark bg-brand/10 px-3 py-2 text-center text-sm tabular-nums font-bold">
                    {actualsReleased ? (
                      <>
                        {totals.actual.mi} / {totals.actual.mo}
                        <span className="ml-1 text-xs font-semibold text-muted-foreground">
                          ({formatNet(totals.actual.mi - totals.actual.mo)})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      <p className="text-xs text-muted-foreground">
        Cells show projected move-ins / move-outs. EOM Actual uses ClarityIQ&rsquo;s validated WelcomeHome
        move-in and move-out definitions for the fully completed calendar month, and is released only after the
        month closes and a WelcomeHome sync completes successfully — an open month always shows &ldquo;—&rdquo;.
        Past weekly forecasts are preserved as point-in-time records; only an organization admin may correct a
        week that has already ended.
      </p>

      <ForecastEditDialog
        target={edit}
        onClose={() => setEdit(null)}
        onSave={async (values) => {
          if (!edit || !organizationId) return;
          try {
            await save.mutateAsync({
              organizationId,
              communityId: edit.communityId,
              forecastDate: edit.forecastDate,
              entryId: edit.entry?.id ?? null,
              ...values,
            });
            toast.success("Forecast saved");
            setEdit(null);
          } catch (e: any) {
            toast.error(e?.message ?? "Could not save this forecast");
          }
        }}
      />
    </div>
  );
}

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function ForecastEditDialog({
  target,
  onClose,
  onSave,
}: {
  target: EditTarget | null;
  onClose: () => void;
  onSave: (values: {
    projectedMoveIns: number | null;
    projectedMoveOuts: number | null;
    stretchGoal: number | null;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [mi, setMi] = useState("");
  const [mo, setMo] = useState("");
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const currentKey = target ? `${target.communityId}|${target.forecastDate}` : "";
  useEffect(() => {
    if (!target) return;
    setMi(target.entry?.projected_move_ins?.toString() ?? "");
    setMo(target.entry?.projected_move_outs?.toString() ?? "");
    setGoal(target.entry?.stretch_goal?.toString() ?? "");
    setNotes(target.entry?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const locked = target ? isPastForecastWeek(target.forecastDate) : false;

  return (
    <Dialog open={!!target} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {target?.communityName} — {target ? formatShortDate(target.forecastDate) : ""}
          </DialogTitle>
          <DialogDescription>
            {locked
              ? "This forecast week has ended. It is preserved as a point-in-time record; only an organization admin can save a correction."
              : "Weekly projection for this community. Previous weeks are never overwritten."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fmi">Projected move-ins</Label>
            <Input id="fmi" inputMode="numeric" value={mi} onChange={(e) => setMi(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fmo">Projected move-outs</Label>
            <Input id="fmo" inputMode="numeric" value={mo} onChange={(e) => setMo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fgoal">Stretch / goal</Label>
            <Input id="fgoal" inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fnotes">Forecast notes</Label>
          <Textarea id="fnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {target?.entry?.historical_source_note ? (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            Historical source note: {target.entry.historical_source_note}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  projectedMoveIns: toIntOrNull(mi),
                  projectedMoveOuts: toIntOrNull(mo),
                  stretchGoal: toIntOrNull(goal),
                  notes: notes.trim() || null,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save forecast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
