import { supabase } from "@/integrations/supabase/client";

/**
 * Invitation / password-recovery link handling.
 *
 * Supabase email links land on the app with the credentials either in the URL
 * hash (implicit flow: `#access_token=...&type=invite`), in a `?code=` query
 * parameter (PKCE), or as `?token_hash=...&type=...`. The parameters are
 * captured synchronously on module load so the client's own
 * `detectSessionInUrl` handling cannot race us and clear them first.
 *
 * Nothing here is logged: tokens never leave this module.
 */

type Captured = {
  hash: URLSearchParams;
  query: URLSearchParams;
};

const captured: Captured | null =
  typeof window === "undefined"
    ? null
    : {
        hash: new URLSearchParams(window.location.hash.replace(/^#/, "")),
        query: new URLSearchParams(window.location.search),
      };

export type LinkFlow = "invite" | "recovery" | "unknown";

export type LinkResult =
  | { status: "ready"; flow: LinkFlow }
  | { status: "invalid"; message: string };

function describe(code: string | null, description: string | null): string {
  if (description) return description.replace(/\+/g, " ");
  if (code === "otp_expired") return "This link has expired.";
  return "This link is no longer valid.";
}

function detectFlow(params: URLSearchParams[]): LinkFlow {
  for (const p of params) {
    const type = p.get("type");
    if (type === "invite" || type === "signup") return "invite";
    if (type === "recovery") return "recovery";
  }
  return "unknown";
}

/**
 * Establishes the session carried by an invitation or recovery link.
 * Returns `ready` only when an authenticated session exists afterwards.
 */
export async function consumeAuthLink(): Promise<LinkResult> {
  if (!captured) return { status: "invalid", message: "This link is no longer valid." };

  const { hash, query } = captured;
  const flow = detectFlow([hash, query]);

  const errorCode = hash.get("error_code") ?? query.get("error_code");
  const errorDescription =
    hash.get("error_description") ?? query.get("error_description") ?? hash.get("error") ?? query.get("error");
  if (errorCode || hash.get("error") || query.get("error")) {
    return { status: "invalid", message: describe(errorCode, errorDescription) };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const otpType = query.get("type");

  try {
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return { status: "invalid", message: describe(null, error.message) };
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { status: "invalid", message: describe(null, error.message) };
    } else if (tokenHash && otpType) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as "invite" | "recovery" | "signup" | "email",
      });
      if (error) return { status: "invalid", message: describe(null, error.message) };
    }

    // The client may already have consumed the link parameters itself; the
    // presence of a session is the real test.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      return {
        status: "invalid",
        message: "This link is no longer valid or has already been used.",
      };
    }
    return { status: "ready", flow };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "This link is no longer valid.",
    };
  } finally {
    // Remove the credentials from the address bar.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }
}

export function validatePassword(password: string, confirm: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
