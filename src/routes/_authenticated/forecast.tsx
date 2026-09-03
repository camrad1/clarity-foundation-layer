import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  monthStart,
  recentMonths,
  todayISO,
} from "@/lib/forecast/period";
import {
  useForecastEntries,
  useForecastEomActuals,
  useSaveForecast,
  type ForecastEntry,
} from "@/lib/forecast/queries";
import { resolveSelectedCommunityIds, useAppState } from "@/state/app-state";

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
  const save = useSaveForecast(month);
  const [edit, setEdit] = useState<EditTarget | null>(null);

  const byCell = useMemo(() => {
    const map = new Map<string, ForecastEntry>();
    for (const e of entries.data ?? []) map.set(`${e.community_id}|${e.forecast_date}`, e);
    return map;
  }, [entries.data]);

  const actualByCommunity = useMemo(() => {
    const map = new Map<string, { move_ins: number; move_outs: number }>();
    for (const a of actuals.data ?? []) map.set(a.community_id, a);
    return map;
  }, [actuals.data]);

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
                  {dates.map((d) => (
                    <th key={d} className="px-3 py-2 text-center font-medium whitespace-nowrap">
                      {formatShortDate(d)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center font-medium whitespace-nowrap">EOM Actual</th>
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
                        return (
                          <td key={d} className="px-1 py-1 text-center">
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
                                    ({net >= 0 ? "+" : ""}
                                    {net})
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
                      <td className="px-3 py-1.5 text-center tabular-nums font-medium">
                        {actual ? `${actual.move_ins} / ${actual.move_outs}` : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-brand bg-brand-light/70 font-semibold">
                  <td className="sticky left-0 z-10 bg-brand-light px-3 py-2">TOTAL</td>
                  {totals.perDate.map((t) => (
                    <td key={t.date} className="px-3 py-2 text-center tabular-nums">
                      {t.any ? (
                        <>
                          {t.mi} / {t.mo}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({t.mi - t.mo >= 0 ? "+" : ""}
                            {t.mi - t.mo})
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center tabular-nums">
                    {totals.actual.mi} / {totals.actual.mo}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({totals.actual.mi - totals.actual.mo >= 0 ? "+" : ""}
                      {totals.actual.mi - totals.actual.mo})
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      <p className="text-xs text-muted-foreground">
        Cells show projected move-ins / move-outs. EOM Actual uses ClarityIQ&rsquo;s validated WelcomeHome
        move-in and move-out definitions. Past weekly forecasts are preserved as point-in-time records; only an
        organization admin may correct a week that has already ended.
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
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const currentKey = target ? `${target.communityId}|${target.forecastDate}` : "";
  if (target && currentKey !== key) {
    setKey(currentKey);
    setMi(target.entry?.projected_move_ins?.toString() ?? "");
    setMo(target.entry?.projected_move_outs?.toString() ?? "");
    setGoal(target.entry?.stretch_goal?.toString() ?? "");
    setNotes(target.entry?.notes ?? "");
  }

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
