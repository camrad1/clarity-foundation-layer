import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Signal } from "lucide-react";
import { consumeAuthLink } from "@/lib/auth/email-link";

export const Route = createFileRoute("/auth_/callback")({
  head: () => ({
    meta: [
      { title: "Signing you in — ONELIFE Marketing Performance Hub" },
      { name: "description", content: "Completing your ClarityIQ sign-in link." },
      { property: "og:title", content: "Signing you in" },
      { property: "og:description", content: "Completing your ClarityIQ sign-in link." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consumeAuthLink().then((result) => {
      if (result.status === "ready") {
        if (result.flow === "recovery") navigate({ to: "/reset-password" });
        // Authorization (active + membership) is re-checked by the protected area.
        else navigate({ to: "/overview" });
      } else setError(result.message);
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Signal className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">ClarityIQ</span>
        </div>
        {error ? (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold tracking-tight">This sign-in link is no longer valid.</h1>
            <p className="text-sm text-muted-foreground">
              Links work once and expire after a short time. Request a new one from the sign-in page.
            </p>
            <Link to="/auth" className="inline-block text-sm font-medium text-primary underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
