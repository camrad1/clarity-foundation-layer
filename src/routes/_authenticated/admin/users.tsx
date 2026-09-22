import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { KeyRound, Plus, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCommunities, useOrgRole, useRegions } from "@/lib/clarity-queries";
import {
  roleNeedsCommunities,
  roleNeedsRegions,
  useCreateUser,
  useOrgUsers,
  useSendPasswordSetup,
  useSetUserActive,
  useUpdateUser,
  userRoleLabel,
  USER_ROLES,
  type ManagedUser,
} from "@/lib/admin/use-users";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Users — ONELIFE Marketing Performance Hub Admin" },
      {
        name: "description",
        content:
          "Create ClarityIQ accounts, set roles, assign community access and deactivate users.",
      },
      { property: "og:title", content: "Users — ONELIFE Marketing Performance Hub Admin" },
      {
        property: "og:description",
        content: "Administer ClarityIQ user accounts, roles and community access.",
      },
    ],
  }),
  component: UsersPage,
});

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  communityIds: string[];
  regionIds: string[];
  active: boolean;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  role: "community_user",
  communityIds: [],
  regionIds: [],
  active: true,
};

function UsersPage() {
  const { organizationId } = useAppState();
  const { isOrgAdmin, isPlatformAdmin, loading } = useOrgRole(organizationId);
  const users = useOrgUsers(organizationId);
  const communities = useCommunities(organizationId);
  const regions = useRegions(organizationId);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [communityFilter, setCommunityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [confirming, setConfirming] = useState<ManagedUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const createUser = useCreateUser(organizationId);
  const updateUser = useUpdateUser(organizationId);
  const setActive = useSetUserActive(organizationId);
  const sendSetup = useSendPasswordSetup(organizationId);

  const communityName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of communities.data ?? []) map.set(c.id, c.name);
    return map;
  }, [communities.data]);

  const regionName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of regions.data ?? []) map.set(r.id, r.name);
    return map;
  }, [regions.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users.data ?? []).filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "inactive" && u.is_active) return false;
      if (communityFilter !== "all") {
        const orgWide = !roleNeedsCommunities(u.role);
        if (!orgWide && !u.community_ids.includes(communityFilter)) return false;
      }
      if (!term) return true;
      const name = `${u.first_name ?? ""} ${u.last_name ?? ""} ${u.full_name ?? ""}`.toLowerCase();
      return name.includes(term) || (u.email ?? "").toLowerCase().includes(term);
    });
  }, [users.data, search, roleFilter, statusFilter, communityFilter]);

  if (!loading && !isOrgAdmin) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Admin" title="Users" />
        <EmptyState
          icon={<ShieldCheck className="size-6" />}
          title="Administrator access required"
          description="Managing ClarityIQ accounts requires Super Admin or Corporate Admin permissions."
        />
      </div>
    );
  }

  const roleOptions = USER_ROLES.filter(
    (r) => isPlatformAdmin || (r.value !== "platform_admin" && r.value !== "organization_admin"),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Create accounts, set roles and assign community access. Community limits are enforced in the database, so a limited user can never retrieve another community's data by changing a link or request."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add User
          </Button>
        }
      />

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="user-search">Search</Label>
          <Input
            id="user-search"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48 space-y-1.5">
          <Label>Role</Label>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {USER_ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56 space-y-1.5">
          <Label>Community</Label>
          <Select value={communityFilter} onValueChange={setCommunityFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All communities</SelectItem>
              {(communities.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable<ManagedUser>
        loading={users.isLoading}
        rows={rows}
        empty={
          <EmptyState
            icon={<Users className="size-6" />}
            title="No users match these filters"
            description="Adjust the filters, or add a user to this organization."
          />
        }
        columns={[
          {
            key: "name",
            header: "Name",
            render: (r) => (
              <span className="font-medium">
                {[r.first_name, r.last_name].filter(Boolean).join(" ") ||
                  r.full_name ||
                  "Unnamed user"}
              </span>
            ),
          },
          {
            key: "email",
            header: "Email",
            render: (r) => <span className="text-sm text-muted-foreground">{r.email ?? "—"}</span>,
          },
          { key: "role", header: "Role", render: (r) => userRoleLabel(r.role) },
          {
            key: "communities",
            header: "Data scope",
            render: (r) => {
              if (!roleNeedsCommunities(r.role))
                return (
                  <span className="text-sm text-muted-foreground">
                    All communities (organization-wide)
                  </span>
                );
              const regionLabels = r.region_ids
                .map((id) => regionName.get(id) ?? "Unknown region")
                .sort();
              const communityLabels = r.community_ids
                .map((id) => communityName.get(id) ?? "Unknown")
                .sort();
              if (!regionLabels.length && !communityLabels.length)
                return <span className="text-sm text-warning">No access assigned</span>;
              return (
                <div className="space-y-0.5 text-sm">
                  {regionLabels.length ? (
                    <p>
                      <span className="text-muted-foreground">Regions: </span>
                      {regionLabels.join(", ")}
                    </p>
                  ) : null}
                  {communityLabels.length ? <p>{communityLabels.join(", ")}</p> : null}
                </div>
              );
            },
          },
          {
            key: "status",
            header: "Status",
            render: (r) => <StatusPill status={r.is_active ? "active" : "inactive"} />,
          },
          {
            key: "last_login",
            header: "Last login",
            render: (r) =>
              r.last_sign_in_at ? (
                format(new Date(r.last_sign_in_at), "MMM d, yyyy h:mm a")
              ) : (
                <span className="text-muted-foreground">Never</span>
              ),
          },
          {
            key: "actions",
            header: "Actions",
            align: "right",
            render: (r) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  disabled={!r.email || sendSetup.isPending}
                  onClick={() => {
                    if (!r.email) return;
                    sendSetup.mutate(
                      { email: r.email },
                      {
                        onSuccess: () => toast.success("Password setup email sent"),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : "Could not send the email"),
                      },
                    );
                  }}
                >
                  <KeyRound className="size-3.5" /> Password
                </Button>
                {r.is_active ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(r)}>
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setActive.mutate(
                        { userId: r.user_id, active: true },
                        {
                          onSuccess: () => toast.success("User reactivated"),
                          onError: (e) =>
                            toast.error(e instanceof Error ? e.message : "Could not reactivate"),
                        },
                      )
                    }
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <UserFormDialog
        key={addOpen ? "add-open" : "add-closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add user"
        description="The new account is created in ClarityIQ and a secure password setup email is sent. If invite email is unavailable, a one-time temporary password is shown instead."
        submitLabel="Create user"
        initial={EMPTY_FORM}
        showEmail
        showActive
        roleOptions={roleOptions}
        communities={communities.data ?? []}
        regions={regions.data ?? []}
        busy={createUser.isPending}
        onSubmit={async (form) => {
          const result = await createUser.mutateAsync(form);
          setAddOpen(false);
          if (result.temporaryPassword) {
            setTemporaryPassword(result.temporaryPassword);
            toast.success("User created with a temporary password");
          } else {
            toast.success("User created — password setup email sent");
          }
        }}
      />

      {editing ? (
        <UserFormDialog
          key={editing.user_id}
          open
          onOpenChange={(v) => !v && setEditing(null)}
          title="Edit user"
          description="Manage this account's details together with its role, region and community access. Access changes take effect immediately and are enforced in the database."
          submitLabel="Save changes"
          initial={{
            firstName: editing.first_name ?? "",
            lastName: editing.last_name ?? "",
            email: editing.email ?? "",
            role: editing.role,
            communityIds: editing.community_ids,
            regionIds: editing.region_ids,
            active: editing.is_active,
          }}
          roleOptions={roleOptions}
          communities={communities.data ?? []}
          regions={regions.data ?? []}
          busy={updateUser.isPending}
          onSubmit={async (form) => {
            await updateUser.mutateAsync({
              userId: editing.user_id,
              firstName: form.firstName,
              lastName: form.lastName,
              role: form.role,
              communityIds: form.communityIds,
              regionIds: form.regionIds,
            });
            setEditing(null);
            toast.success("User updated");
          }}
        />
      ) : null}

      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.email ?? "This user"} will immediately lose access to ClarityIQ and will
              not be able to sign in. The account stays in this list with all of its history and can
              be reactivated at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (!target) return;
                setActive.mutate(
                  { userId: target.user_id, active: false },
                  {
                    onSuccess: () => toast.success("User deactivated"),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not deactivate"),
                  },
                );
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!temporaryPassword} onOpenChange={(v) => !v && setTemporaryPassword(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Invite email is not available in this environment, so the account was created with a
              temporary password. Copy it now — it is shown once and never stored anywhere you can
              read it again. The user can change it at any time from the sign-in screen.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm">
            {temporaryPassword}
          </p>
          <DialogFooter>
            <Button onClick={() => setTemporaryPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  roleOptions,
  communities,
  showEmail,
  showActive,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initial: FormState;
  roleOptions: readonly { value: string; label: string }[];
  communities: { id: string; name: string }[];
  showEmail?: boolean;
  showActive?: boolean;
  busy?: boolean;
  onSubmit: (form: FormState) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const needsCommunities = roleNeedsCommunities(form.role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onSubmit(form);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this user");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                required
                value={form.firstName}
                onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-name">Last name</Label>
              <Input
                id="last-name"
                required
                value={form.lastName}
                onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))}
              />
            </div>
          </div>

          {showEmail ? (
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <p className="text-sm text-muted-foreground">
                {form.email || "—"} — the sign-in email cannot be changed here.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((s) => ({ ...s, role: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Community access</Label>
            {needsCommunities ? (
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {communities.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.communityIds.includes(c.id)}
                      onCheckedChange={(checked) =>
                        setForm((s) => ({
                          ...s,
                          communityIds: checked
                            ? [...s.communityIds, c.id]
                            : s.communityIds.filter((id) => id !== c.id),
                        }))
                      }
                    />
                    {c.name}
                  </label>
                ))}
                {communities.length ? null : (
                  <p className="text-sm text-muted-foreground">No communities available.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This role has access to every community in the organization, so no community list is
                needed.
              </p>
            )}
          </div>

          {showActive ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive accounts cannot sign in or retrieve any data.
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((s) => ({ ...s, active: v }))}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
