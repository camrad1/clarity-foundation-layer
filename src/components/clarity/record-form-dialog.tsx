import { useState, type ReactNode } from "react";
import { useOrgRole } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";
import { Plus } from "lucide-react";
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

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export function RecordFormDialog({
  title,
  description,
  fields,
  submitLabel = "Create",
  trigger,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: FieldSpec[];
  submitLabel?: string;
  trigger?: ReactNode;
  onSubmit: (get: (name: string) => string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { organizationId } = useAppState();
  const { isOrgAdmin } = useOrgRole(organizationId);

  // Presentation only — row level security is the real boundary. Users without
  // administrative rights are simply not shown controls they cannot use.
  if (!isOrgAdmin) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit((n) => values[n] ?? "");
      toast.success(`${title} saved`);
      setValues({});
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" /> {submitLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={f.name}>{f.label}</Label>
              {f.type === "select" ? (
                <Select
                  value={values[f.name] ?? ""}
                  onValueChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
                >
                  <SelectTrigger id={f.name}>
                    <SelectValue placeholder={f.placeholder ?? "Select…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea
                  id={f.name}
                  value={values[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
                />
              ) : (
                <Input
                  id={f.name}
                  type={f.type ?? "text"}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
                />
              )}
              {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
            </div>
          ))}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
