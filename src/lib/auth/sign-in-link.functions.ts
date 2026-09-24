import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public "Email me a sign-in link" request.
 *
 * A link is only sent when the email belongs to an existing, active ClarityIQ
 * user with a membership in an active organization. Every other case returns
 * the same result, so callers cannot learn whether an account exists.
 * Auth users are never created here (shouldCreateUser: false).
 */
export const requestSignInLink = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ email: z.string().trim().email().max(320), redirectTo: z.string().url().max(500) }).parse(data),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active")
        .ilike("email", email)
        .maybeSingle();
      if (!profile || profile.is_active === false) return { ok: true };

      const { data: memberships } = await supabaseAdmin
        .from("organization_memberships")
        .select("organization_id, organizations!inner(status)")
        .eq("user_id", profile.id)
        .eq("organizations.status", "active")
        .limit(1);
      if (!memberships || memberships.length === 0) return { ok: true };

      // Banned (deactivated) auth users are skipped as well.
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      const bannedUntil = (authUser?.user as { banned_until?: string | null } | undefined)?.banned_until;
      if (!authUser?.user || (bannedUntil && new Date(bannedUntil) > new Date())) return { ok: true };

      // Only same-origin callback destinations.
      const redirect = new URL(data.redirectTo);
      if (redirect.pathname !== "/auth/callback") return { ok: true };

      await supabaseAdmin.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirect.toString() },
      });
    } catch {
      // Swallowed deliberately: errors must not reveal whether an account exists.
    }
    return { ok: true };
  });
