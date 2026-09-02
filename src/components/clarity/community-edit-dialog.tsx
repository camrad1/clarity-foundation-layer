import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";
import { useFlashBudgets, useSaveFlashBudget } from "@/lib/flash/queries";
import { effectiveBudget } from "@/lib/wh/occupancy";

type CommunityRow = {
  id: string;
  name: string;
  street_address?: string | null;
  city: string | null;
  state: string | null;
  region_id: string | null;
  timezone: string;
  unit_count: number | null;
};

/**
 * Edits the ClarityIQ-owned community profile. Source identifiers and community
 * mappings are never touched here, and the configured unit count never
 * overwrites the WelcomeHome census denominator — a mismatch is reported on
 * Data Health instead.
 */
export function CommunityEditDialog({
  community,
  regions,
}: {
  community: CommunityRow;
  regions: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { isOrgAdmin } = useOrgRole(organizationId);
  const budgets = useFlashBudgets(organizationId);
  const saveBudget = useSaveFlashBudget(organizationId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = effectiveBudget(budgets.data ?? [], community.id);
  const [v, setV] = useState({
    name: community.name,
    street_address: community.street_address ?? "",
    city: community.city ?? "",
    state: community.state ?? "",
    region_id: community.region_id ?? "none",
    timezone: community.timezone,
    unit_count: community.unit_count == null ? "" : String(community.unit_count),
    budget_units: "",
    budget_start: new Date().toISOString().slice(0, 10),
    budget_notes: "",
  });

  // Presentation only — row level security remains the real boundary.
  if (!isOrgAdmin) return null;

  function set(k: keyof typeof v, value: string) {
    setV((s) => ({ ...s, [k]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase
        .from("communities")
        .update({
          name: v.name,
          street_address: v.street_address || null,
          city: v.city || null,
          state: v.state || null,
          region_id: v.region_id === "none" ? null : v.region_id,
          timezone: v.timezone,
          unit_count: v.unit_count ? Number(v.unit_count) : null,
        } as never)
        .eq("id", community.id);
      if (error) throw error;

      if (v.budget_units) {
        await saveBudget.mutateAsync({
          community_id: community.id,
          effective_start: v.budget_start,
          effective_end: null,
          budget_occupied_units: Number(v.budget_units),
          budget_occupancy_pct: null,
          notes: v.budget_notes || null,
        });
      }

      await qc.invalidateQueries({ queryKey: ["communities", organizationId] });
      await qc.invalidateQueries({ queryKey: ["wh_current_occupancy"] });
      toast.success("Community saved");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save community");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Pencil className="size-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {community.name}</DialogTitle>
          <DialogDescription>
            Community profile and budgeted occupancy. Source identifiers and mappings are unchanged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Community name">
            <Input value={v.name} required onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Street address">
            <Input value={v.street_address} onChange={(e) => set("street_address", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <Input value={v.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="State">
              <Input value={v.state} onChange={(e) => set("state", e.target.value)} />
            </Field>
          </div>
          <Field label="Region">
            <Select value={v.region_id} onValueChange={(x) => set("region_id", x)}>
              <SelectTrigger>
                <SelectValue placeholder="No region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No region</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Reporting timezone"
            help="Reporting periods are calculated in this timezone."
          >
            <Input value={v.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
          <Field
            label="Operational units"
            help="ClarityIQ's configured capacity. It never replaces the WelcomeHome census denominator; differences are reported on Data Health."
          >
            <Input
              type="number"
              value={v.unit_count}
              onChange={(e) => set("unit_count", e.target.value)}
            />
          </Field>

          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Budgeted occupancy</p>
            <p className="mb-3 text-xs text-muted-foreground">
              {current
                ? `In force since ${current.effective_start}: ${current.budget_occupied_units ?? "—"} occupied units.`
                : "No budget configured yet."}{" "}
              Saving adds a new date-effective budget; history is preserved.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Budgeted occupied units">
                <Input
                  type="number"
                  value={v.budget_units}
                  onChange={(e) => set("budget_units", e.target.value)}
                />
              </Field>
              <Field label="Effective from">
                <Input
                  type="date"
                  value={v.budget_start}
                  onChange={(e) => set("budget_start", e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Budget notes">
                <Textarea
                  value={v.budget_notes}
                  onChange={(e) => set("budget_notes", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}
