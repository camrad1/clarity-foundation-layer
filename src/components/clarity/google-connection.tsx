import { useEffect, useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { CheckCircle2, Copy, LinkIcon, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { StatusPill } from "@/components/clarity/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrgRole } from "@/lib/clarity-queries";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_SERVICE_LABELS, type GoogleService } from "@/lib/google/config";
import {
  googleCompareSearchConsole,
  googleDisconnect,
  googleListProperties,
  googleSelectProperty,
  googleSetupInfo,
  googleStartConnect,
  googleValidationSync,
} from "@/lib/google/google.functions";

import { useGoogleConnection } from "@/lib/google/queries";
import { useAppState } from "@/state/app-state";

function fmt(d: string | null | undefined) {
  return d ? format(new Date(d), "MMM d, yyyy h:mm a") : "Never";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export function GoogleConnectionPage({
  service,
  routePath,
}: {
  service: GoogleService;
  routePath: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { google?: string; reason?: string };
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const connection = useGoogleConnection(organizationId, service);
  const [selected, setSelected] = useState<string>("");

  const setupInfoFn = useServerFn(googleSetupInfo);
  const startConnect = useServerFn(googleStartConnect);
  const listProperties = useServerFn(googleListProperties);
  const selectProperty = useServerFn(googleSelectProperty);
  const disconnect = useServerFn(googleDisconnect);

  const setup = useQuery({
    queryKey: ["google_setup_info"],
    queryFn: async () => await setupInfoFn({} as never),
  });

  const redirectUri =
    setup.data?.redirectUriOverride ??
    (typeof window !== "undefined"
      ? new URL(GOOGLE_OAUTH_CALLBACK_PATH, window.location.origin).toString()
      : GOOGLE_OAUTH_CALLBACK_PATH);

  useEffect(() => {
    if (search.google === "connected") {
      toast.success("Google account authorized");
      void connection.refetch();
      void navigate({ to: routePath, search: {}, replace: true });
    } else if (search.google === "error") {
      toast.error(search.reason ? `Google sign-in failed: ${search.reason}` : "Google sign-in failed");
      void navigate({ to: routePath, search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.google]);

  const connect = useMutation({
    mutationFn: async () => {
      const res = await startConnect({
        data: {
          organizationId: organizationId!,
          service,
          origin: window.location.origin,
          returnPath: routePath,
        },
      });
      return res;
    },
    onSuccess: (res) => {
      window.location.href = res.authUrl;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const properties = useMutation({
    mutationFn: async () =>
      await listProperties({ data: { organizationId: organizationId!, service } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const list = properties.data;
      if (!list) throw new Error("Load the available properties first.");
      if (service === "search_console") {
        const p = list.properties.find((x: any) => x.siteUrl === selected);
        if (!p) throw new Error("Choose a property.");
        return await selectProperty({
          data: {
            organizationId: organizationId!,
            service,
            propertyId: p.siteUrl,
            propertyName: p.siteUrl,
            propertyType: p.propertyType,
          },
        });
      }
      const p = list.ga4Properties.find((x: any) => x.propertyId === selected);
      if (!p) throw new Error("Choose a property.");
      return await selectProperty({
        data: {
          organizationId: organizationId!,
          service,
          propertyId: p.propertyId,
          propertyName: p.displayName,
          propertyType: p.accountName ? `Account: ${p.accountName}` : "GA4 property",
        },
      });
    },
    onSuccess: () => {
      toast.success("Property saved");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runValidation = useServerFn(googleValidationSync);
  const runCompare = useServerFn(googleCompareSearchConsole);

  const validation = useMutation({
    mutationFn: async () =>
      await runValidation({ data: { organizationId: organizationId!, service, days: 5 } }),
    onSuccess: () => {
      toast.success("Validation pull finished");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const compare = useMutation({
    mutationFn: async () => await runCompare({ data: { organizationId: organizationId! } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: async () => await disconnect({ data: { organizationId: organizationId!, service } }),
    onSuccess: () => {
      toast.success("Google access removed. Imported data was kept.");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const label = GOOGLE_SERVICE_LABELS[service];
  const conn = connection.data;
  const status = conn?.status ?? "disconnected";

  if (!organizationId) {
    return <EmptyState title="Select an organization" description="Choose an organization to manage this connection." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${label} Connection`}
        description={`Authorize ${label} with Google sign-in, choose the canonical ONELIFE property and monitor read-only synchronization.`}
      />

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusPill
              status={status === "connected" ? "connected" : status === "authorized" ? "pending" : "disconnected"}
            />
            {conn?.google_account_email ? (
              <span className="text-sm text-muted-foreground">{conn.google_account_email}</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              variant={status === "disconnected" ? "default" : "outline"}
              disabled={!canManageImports || connect.isPending || !setup.data?.configured}
              onClick={() => connect.mutate()}
            >
              <LinkIcon className="mr-2 size-4" />
              {status === "disconnected" ? "Connect Google" : "Reconnect"}
            </Button>
            {status !== "disconnected" ? (
              <Button variant="outline" disabled={!canManageImports || unlink.isPending} onClick={() => unlink.mutate()}>
                <Unplug className="mr-2 size-4" />
                Disconnect
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Google account" value={conn?.google_account_email ?? "—"} />
          <Field label="Selected property" value={conn?.selected_property_name ?? "—"} />
          <Field label="Property type" value={conn?.selected_property_type ?? "—"} />
          <Field label="Last successful sync" value={fmt(conn?.last_successful_sync_at)} />
          <Field
            label="Latest source data date"
            value={conn?.latest_data_date ? format(new Date(`${conn.latest_data_date}T00:00:00`), "MMM d, yyyy") : "—"}
          />
          <Field label="Next scheduled sync" value="Nightly — starts after backfill approval" />
        </div>

        {conn?.last_error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{conn.last_error}</p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Validation pull</h2>
            <p className="text-sm text-muted-foreground">
              Fetches only a few recent days into a separate, clearly labeled area. Existing imports and
              dashboards are not changed.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!canManageImports || !conn?.selected_property_id || validation.isPending}
              onClick={() => validation.mutate()}
            >
              <RefreshCw className={`mr-2 size-4 ${validation.isPending ? "animate-spin" : ""}`} />
              Run validation pull
            </Button>
            {service === "search_console" ? (
              <Button
                variant="outline"
                disabled={!canManageImports || compare.isPending}
                onClick={() => compare.mutate()}
              >
                Compare with manual import
              </Button>
            ) : null}
          </div>
        </div>
        {validation.data ? (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(validation.data, null, 2)}
          </pre>
        ) : null}
        {compare.data ? (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(compare.data, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-3">

        <h2 className="text-sm font-semibold">Google Cloud redirect URI</h2>
        <p className="text-sm text-muted-foreground">
          Add this exact address to the authorized redirect URIs of your Google Cloud OAuth client.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{redirectUri}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(redirectUri);
              toast.success("Copied");
            }}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        {!setup.data?.configured ? (
          <p className="text-sm text-amber-600">
            The Google OAuth client id and secret have not been saved yet, so connecting is disabled.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Canonical property</h2>
            <p className="text-sm text-muted-foreground">
              Load the properties this Google account can read, then confirm the ONELIFE property.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!canManageImports || status === "disconnected" || properties.isPending}
            onClick={() => properties.mutate()}
          >
            <RefreshCw className={`mr-2 size-4 ${properties.isPending ? "animate-spin" : ""}`} />
            Load properties
          </Button>
        </div>

        {properties.data ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:max-w-xl">
              <Label>Available properties</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {service === "search_console"
                    ? properties.data.properties.map((p: any) => (
                        <SelectItem key={p.siteUrl} value={p.siteUrl}>
                          {p.siteUrl} — {p.propertyType} ({p.permissionLevel})
                        </SelectItem>
                      ))
                    : properties.data.ga4Properties.map((p: any) => (
                        <SelectItem key={p.propertyId} value={p.propertyId}>
                          {p.displayName} — {p.propertyId}
                          {p.accountName ? ` (${p.accountName})` : ""}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!selected || save.isPending} onClick={() => save.mutate()}>
              <CheckCircle2 className="mr-2 size-4" />
              Save property
            </Button>
            <p className="text-xs text-muted-foreground">
              {service === "search_console"
                ? `${properties.data.properties.length} accessible Search Console properties`
                : `${properties.data.ga4Properties.length} accessible GA4 properties`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No properties loaded yet. Connect Google, then choose “Load properties”.
          </p>
        )}
      </section>
    </div>
  );
}
