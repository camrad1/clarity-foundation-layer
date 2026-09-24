import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Signal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ONELIFE Marketing Performance Hub" },
      { name: "description", content: "Sign in to your ClarityIQ performance intelligence workspace." },
      { property: "og:title", content: "Sign in — ONELIFE Marketing Performance Hub" },
      { property: "og:description", content: "Access your ClarityIQ workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "magic">("signin");
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    // An invitation or recovery link that falls back to the site root must not
    // be treated as a normal sign-in: hand it to the set-password pages with
    // its link parameters intact.
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      const type = params.get("type") ?? new URLSearchParams(window.location.search).get("type");
      if (type === "invite" || type === "signup") {
        window.location.replace(`/accept-invite${window.location.search}#${hash}`);
        return;
      }
      if (type === "recovery") {
        window.location.replace(`/reset-password${window.location.search}#${hash}`);
        return;
      }
      if (type === "magiclink") {
        window.location.replace(`/auth/callback${window.location.search}#${hash}`);
        return;
      }
      try {
        if (sessionStorage.getItem("clarity:no-access")) {
          sessionStorage.removeItem("clarity:no-access");
          toast.error("Your account doesn't have active access to ClarityIQ. Contact your administrator.");
          return;
        }
      } catch {
        /* ignore */
      }
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/overview" });
    });
  }, [navigate]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "forgot") {
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setSent("If an account exists for that email, we've sent password reset instructions.");
      } else {
        await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        setSent("If an account exists for that email, we've sent a sign-in link.");
      }
      // Errors are deliberately not shown: they could reveal whether an account exists.
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/overview" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/overview" });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between border-r border-border bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Signal className="size-4" />
          </div>
          <span className="font-display text-sm font-semibold leading-tight">ONELIFE Marketing Performance Hub</span>
        </div>
        <div className="max-w-md space-y-4">
          <h2 className="font-display text-3xl leading-tight font-semibold">
            Performance intelligence for senior living operators.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Marketing, CRM, sales and occupancy data brought together into one governed,
            auditable view — from visibility all the way through to occupancy.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Every metric is calculated deterministically from source data.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">Sign in to ONELIFE Marketing Performance Hub</h1>
            <p className="text-sm text-muted-foreground">Use your work email to continue.</p>
          </div>

          {mode !== "signin" ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">
                {mode === "forgot" ? "Reset your password" : "Email me a sign-in link"}
              </p>
              {sent ? (
                <p className="text-sm text-muted-foreground">{sent}</p>
              ) : (
                <form onSubmit={sendLink} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="link-email">Work email</Label>
                    <Input
                      id="link-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {mode === "forgot" ? "Send reset instructions" : "Send sign-in link"}
                  </Button>
                </form>
              )}
              <button
                type="button"
                className="text-sm font-medium text-primary underline"
                onClick={() => {
                  setMode("signin");
                  setSent(null);
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setMode("forgot")}
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Sign in
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={() => setMode("magic")}>
              Email me a sign-in link
            </Button>
            <Button variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
          </div>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Need access? Contact your ONELIFE administrator.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Signing in does not grant data access on its own — an administrator must add you to an
            organization.
          </p>
        </div>
      </div>
    </div>
  );
}
