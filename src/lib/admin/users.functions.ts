import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * User management server functions.
 *
 * Authorization model, in order:
 *  1. `requireSupabaseAuth` proves who the caller is.
 *  2. The caller must be an administrator of the organization being managed
 *     (`is_org_admin`, which already includes platform admins and now also
 *     requires an active account).
 *  3. Every write to the public schema goes through `context.supabase`, so the
 *     existing row level security policies and safeguard triggers stay in
 *     force. The service-role client is used only for Supabase Auth admin work
 *     (creating the auth user, invite/reset email, blocking sign-in), never as
 *     a way around a policy.
 */

const ROLE_VALUES = [
  "platform_admin",
  "organization_admin",
  "regional_user",
  "community_user",
  "marketing_user",
  "read_only",
] as const;
type Role = (typeof ROLE_VALUES)[number];

/** Roles whose scope is the whole organization — no community list needed. */
const ORG_WIDE: Role[] = ["platform_admin", "organization_admin", "marketing_user", "read_only"];

function assertRole(role: string): Role {
  if (!(ROLE_VALUES as readonly string[]).includes(role)) throw new Error("Unknown role");
  return role as Role;
}

function assertEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address");
  return value;
}

async function assertOrgAdmin(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  organizationId: string,
) {
  const { data, error } = await supabase.rpc("is_org_admin", { _org_id: organizationId });
  if (error) throw new Error("Could not verify your administrator access");
  if (data !== true) throw new Error("You are not an administrator of this organization");
}

async function isPlatformAdmin(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
) {
  const { data } = await supabase.rpc("is_platform_admin", {});
  return data === true;
}

/** Only a platform administrator may grant the two elevated roles. */
async function assertRoleAssignable(
  supabase: Parameters<typeof isPlatformAdmin>[0],
  role: Role,
) {
  if (role !== "platform_admin" && role !== "organization_admin") return;
  if (!(await isPlatformAdmin(supabase))) {
    throw new Error("Only a super administrator may assign that role");
  }
}

export type ManagedUser = {
  user_id: string;
  membership_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  community_ids: string[];
  region_ids: string[];
  last_sign_in_at: string | null;
  created_at: string;
};

export const listOrgUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { organizationId: string }) => input)
  .handler(async ({ data, context }): Promise<ManagedUser[]> => {
    const { supabase } = context;
    await assertOrgAdmin(supabase as never, data.organizationId);

    const [{ data: memberships, error }, { data: access }, { data: regionAccess }] =
      await Promise.all([
        supabase
          .from("organization_memberships")
          .select("id, user_id, role, created_at")
          .eq("organization_id", data.organizationId),
        supabase
          .from("user_community_access")
          .select("user_id, community_id")
          .eq("organization_id", data.organizationId),
        supabase
          .from("user_region_access")
          .select("user_id, region_id")
          .eq("organization_id", data.organizationId),
      ]);
    if (error) throw error;
    const rows = memberships ?? [];
    if (!rows.length) return [];

    const ids = rows.map((m) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name, first_name, last_name, is_active")
      .in("id", ids);

    // Last sign-in lives in Supabase Auth, which is only readable with the
    // service role. Nothing else from the auth record is returned.
    const lastSignIn = new Map<string, string | null>();
    const emails = new Map<string, string | null>();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (let page = 1; page <= 5; page += 1) {
        const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (listError) break;
        for (const u of list.users) {
          lastSignIn.set(u.id, u.last_sign_in_at ?? null);
          emails.set(u.id, u.email ?? null);
        }
        if (list.users.length < 200) break;
      }
    } catch {
      /* last sign-in is optional information */
    }

    return rows.map((m) => {
      const profile = (profiles ?? []).find((p) => p.id === m.user_id);
      return {
        user_id: m.user_id,
        membership_id: m.id,
        email: profile?.email ?? emails.get(m.user_id) ?? null,
        first_name: profile?.first_name ?? null,
        last_name: profile?.last_name ?? null,
        full_name: profile?.full_name ?? null,
        role: m.role as Role,
        is_active: profile?.is_active ?? true,
        community_ids: (access ?? [])
          .filter((a) => a.user_id === m.user_id)
          .map((a) => a.community_id),
        region_ids: (regionAccess ?? [])
          .filter((a) => a.user_id === m.user_id)
          .map((a) => a.region_id),
        last_sign_in_at: lastSignIn.get(m.user_id) ?? null,
        created_at: m.created_at,
      };
    });
  });

type CreateInput = {
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  communityIds: string[];
  regionIds?: string[];
  active: boolean;
};


export const createOrgUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateInput) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ userId: string; invited: boolean; temporaryPassword: string | null }> => {
      const { supabase } = context;
      await assertOrgAdmin(supabase as never, data.organizationId);
      const role = assertRole(data.role);
      await assertRoleAssignable(supabase as never, role);
      const email = assertEmail(data.email);
      const firstName = data.firstName.trim();
      const lastName = data.lastName.trim();
      if (!firstName || !lastName) throw new Error("First and last name are required");
      const fullName = `${firstName} ${lastName}`;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const metadata = { first_name: firstName, last_name: lastName, full_name: fullName };

      let userId: string | null = null;
      let invited = false;
      let temporaryPassword: string | null = null;

      // Preferred path: Supabase sends a secure password-setup (invite) email.
      const invite = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: metadata });
      if (invite.data?.user && !invite.error) {
        userId = invite.data.user.id;
        invited = true;
      } else {
        // Invite email unavailable in this environment: create the account with
        // a one-time temporary password shown to the administrator instead.
        const password = generateTemporaryPassword();
        const created = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (created.error || !created.data.user) {
          throw new Error(created.error?.message ?? invite.error?.message ?? "Could not create the account");
        }
        userId = created.data.user.id;
        temporaryPassword = password;
      }

      // The profile row is created by the existing new-user trigger; make sure
      // the names and status match what the administrator entered.
      await supabase
        .from("profiles")
        .update({
          email,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          is_active: data.active,
        })
        .eq("id", userId);

      const { error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({ organization_id: data.organizationId, user_id: userId, role });
      if (membershipError) throw membershipError;

      await applyCommunityAccess(supabase as never, data.organizationId, userId, role, data.communityIds);
      if (!data.active) await setAuthSignInBlocked(userId, true);

      return { userId, invited, temporaryPassword };
    },
  );

type UpdateInput = {
  organizationId: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  communityIds: string[];
};

export const updateOrgUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateInput) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertOrgAdmin(supabase as never, data.organizationId);
    const role = assertRole(data.role);
    await assertRoleAssignable(supabase as never, role);
    const firstName = data.firstName.trim();
    const lastName = data.lastName.trim();
    if (!firstName || !lastName) throw new Error("First and last name are required");

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
      })
      .eq("id", data.userId);
    if (profileError) throw profileError;

    const { error: roleError } = await supabase
      .from("organization_memberships")
      .update({ role })
      .eq("organization_id", data.organizationId)
      .eq("user_id", data.userId);
    if (roleError) throw roleError;

    await applyCommunityAccess(
      supabase as never,
      data.organizationId,
      data.userId,
      role,
      data.communityIds,
    );
    return { ok: true };
  });

export const setOrgUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { organizationId: string; userId: string; active: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertOrgAdmin(supabase as never, data.organizationId);
    if (!data.active && data.userId === callerId) {
      throw new Error("You cannot deactivate your own account");
    }

    // The database trigger is the real safeguard (own account, last active
    // super administrator); this surfaces its message to the administrator.
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: data.active })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);

    await setAuthSignInBlocked(data.userId, !data.active);
    return { ok: true };
  });

export const sendPasswordSetupEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { organizationId: string; email: string; redirectTo?: string }) => input)
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase as never, data.organizationId);
    const email = assertEmail(data.email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
      email,
      data.redirectTo ? { redirectTo: data.redirectTo } : undefined,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Community assignments are only meaningful for community-scoped roles. When a
 * user is promoted to an organization-wide role their explicit community rows
 * are removed so the record cannot drift from the role's actual scope.
 */
async function applyCommunityAccess(
  supabase: {
    from: (table: string) => any;
  },
  organizationId: string,
  userId: string,
  role: Role,
  communityIds: string[],
) {
  const wanted = ORG_WIDE.includes(role) ? [] : Array.from(new Set(communityIds));
  const { error: clearError } = await supabase
    .from("user_community_access")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (clearError) throw clearError;
  if (!wanted.length) return;
  const { error } = await supabase.from("user_community_access").insert(
    wanted.map((community_id) => ({ organization_id: organizationId, user_id: userId, community_id })),
  );
  if (error) throw error;
}

/** Inactive accounts are blocked in Supabase Auth so they cannot sign in. */
async function setAuthSignInBlocked(userId: string, blocked: boolean) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: blocked ? "876000h" : "none",
    } as never);
  } catch {
    /* data access is already revoked by row level security */
  }
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}!7`;
}
