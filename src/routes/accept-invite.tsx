import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Signal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { consumeAuthLink, validatePassword } from "@/lib/auth/email-link";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({
    meta: [
      { title: "Finish setting up your account — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content: "Choose a password to finish setting up your ClarityIQ account.",
      },
      { property: "og:title", content: "Finish setting up your account" },
      { property: "og:description", content: "Choose a password to finish setting up your ClarityIQ account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  return (
    <SetPasswordScreen
      heading="Welcome to ClarityIQ"
      intro="Your account has been created. Choose a password to finish setting up your account."
      submitLabel="Complete Setup"
      invalidTitle="This invitation is no longer valid."
      invalidHelp="Please contact your ClarityIQ administrator for a new invitation."
      successMessage="Your password is set. Welcome to ClarityIQ."
    />
  );
}

export function SetPasswordScreen({
  heading,
  intro,
  submitLabel,
  invalidTitle,
  invalidHelp,
  successMessage,
}: {
  heading: string;
  intro: string;
  submitLabel: string;
  invalidTitle: string;
  invalidHelp: string;
  successMessage: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    consumeAuthLink().then((result) => {
      if (cancelled) return;
      if (result.status === "ready") setState("ready");
      else {
        setLinkError(result.message);
        setState("invalid");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validatePassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        toast.success("Your password is set. Please sign in.");
        navigate({ to: "/auth" });
        return;
      }
      toast.success(successMessage);
      navigate({ to: "/overview" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Signal className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">ClarityIQ</span>
        </div>

        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">Checking your link…</p>
        ) : state === "invalid" ? (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold tracking-tight">{invalidTitle}</h1>
            <p className="text-sm text-muted-foreground">{invalidHelp}</p>
            {linkError ? <p className="text-xs text-muted-foreground">{linkError}</p> : null}
            <Link to="/auth" className="inline-block text-sm font-medium text-primary underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              At least 10 characters, including a letter and a number.
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
