import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createOrgUser,
  listOrgUsers,
  sendPasswordSetupEmail,
  setOrgUserActive,
  updateOrgUser,
  type ManagedUser,
} from "@/lib/admin/users.functions";

export type { ManagedUser };

/** ClarityIQ role names as administrators see them, mapped to the database enum. */
export const USER_ROLES = [
  { value: "platform_admin", label: "Super Admin", scope: "org" },
  { value: "organization_admin", label: "Corporate Admin", scope: "org" },
  { value: "regional_user", label: "Regional User", scope: "community" },
  { value: "community_user", label: "Community Admin", scope: "community" },
  { value: "marketing_user", label: "Marketing User", scope: "org" },
  { value: "read_only", label: "Read Only", scope: "org" },
] as const;

export type UserRoleValue = (typeof USER_ROLES)[number]["value"];

export function userRoleLabel(role: string) {
  return USER_ROLES.find((r) => r.value === role)?.label ?? role;
}

/** Roles whose access is limited to explicitly assigned communities. */
export function roleNeedsCommunities(role: string) {
  return USER_ROLES.find((r) => r.value === role)?.scope === "community";
}

/** Only the regional role can additionally be scoped by whole regions. */
export function roleNeedsRegions(role: string) {
  return role === "regional_user";
}

export function useOrgUsers(organizationId: string | null) {
  const list = useServerFn(listOrgUsers);
  return useQuery({
    queryKey: ["admin_users", organizationId],
    enabled: !!organizationId,
    queryFn: () => list({ data: { organizationId: organizationId! } }),
  });
}

function useInvalidate(organizationId: string | null) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ["admin_users", organizationId] });
    await qc.invalidateQueries({ queryKey: ["org_members", organizationId] });
    await qc.invalidateQueries({ queryKey: ["memberships"] });
  };
}

export function useCreateUser(organizationId: string | null) {
  const create = useServerFn(createOrgUser);
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: (input: {
      firstName: string;
      lastName: string;
      email: string;
      role: string;
      communityIds: string[];
      regionIds: string[];
      active: boolean;
    }) =>
      create({
        data: {
          organizationId: organizationId!,
          ...input,
          ...(typeof window === "undefined"
            ? {}
            : { redirectTo: `${window.location.origin}/accept-invite` }),
        },
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(organizationId: string | null) {
  const update = useServerFn(updateOrgUser);
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: (input: {
      userId: string;
      firstName: string;
      lastName: string;
      role: string;
      communityIds: string[];
      regionIds: string[];
    }) => update({ data: { organizationId: organizationId!, ...input } }),
    onSuccess: invalidate,
  });
}


export function useSetUserActive(organizationId: string | null) {
  const setActive = useServerFn(setOrgUserActive);
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: (input: { userId: string; active: boolean }) =>
      setActive({ data: { organizationId: organizationId!, ...input } }),
    onSuccess: invalidate,
  });
}

/**
 * One email mechanism, two destinations:
 *  - someone who has never signed in is finishing setup  -> /accept-invite
 *  - an established user is recovering their password     -> /reset-password
 */
export function useSendPasswordSetup(organizationId: string | null) {
  const send = useServerFn(sendPasswordSetupEmail);
  return useMutation({
    mutationFn: (input: { email: string; mode: "invite" | "reset" }) =>
      send({
        data: {
          organizationId: organizationId!,
          email: input.email,
          ...(typeof window === "undefined"
            ? {}
            : {
                redirectTo: `${window.location.origin}/${
                  input.mode === "invite" ? "accept-invite" : "reset-password"
                }`,
              }),
        },
      }),
  });
}
