import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { CheckCircle2, LinkIcon, RefreshCw, Unplug } from "lucide-react";
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
import { GOOGLE_OAUTH_CALLBACK_PATH } from "@/lib/google/config";
import { googleDisconnect, googleStartConnect } from "@/lib/google/google.functions";
import {
  adsDiscoverAccounts,
  adsSelectAccount,
  adsSetupInfo,
  adsTestConnection,
  adsValidationPull,
  adsValidationSummary,
} from "@/lib/google/ads.functions";
import { useGoogleConnection } from "@/lib/google/queries";
import { useAppState } from "@/state/app-state";

const ROUTE_PATH = "/admin/google-ads-connection";

function fmtTime(d: string | null | undefined) {
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

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

const int = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n));

export function GoogleAdsConnectionPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { google?: string; reason?: string };
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const connection = useGoogleConnection(organizationId, "google_ads");
  const conn = connection.data as any;

  const [chosen, setChosen] = useState<string>("");

  const setupFn = useServerFn(adsSetupInfo);
  const startConnect = useServerFn(googleStartConnect);
  const disconnect = useServerFn(googleDisconnect);
  const discoverFn = useServerFn(adsDiscoverAccounts);
  const selectFn = useServerFn(adsSelectAccount);
  const testFn = useServerFn(adsTestConnection);
  const pullFn = useServerFn(adsValidationPull);
  const summaryFn = useServerFn(adsValidationSummary);

  const setup = useQuery({
    queryKey: ["google_ads_setup"],
    queryFn: async () => await setupFn({} as never),
  });

  const summary = useQuery({
    queryKey: ["google_ads_validation_summary", organizationId],
    enabled: !!organizationId && !!conn?.ads_customer_id,
    queryFn: async () => await summaryFn({ data: { organizationId: organizationId! } }),
  });

  const redirectUri =
    setup.data?.redirectUriOverride ??
    (typeof window !== "undefined"
      ? new URL(GOOGLE_OAUTH_CALLBACK_PATH, window.location.origin).toString()
      : GOOGLE_OAUTH_CALLBACK_PATH);

  useEffect(() => {
    if (search.google === "connected") {
      toast.success("Google account authorized for Google Ads");
      void connection.refetch();
      void navigate({ to: ROUTE_PATH, search: {}, replace: true });
    } else if (search.google === "error") {
      toast.error(search.reason ? `Google sign-in failed: ${search.reason}` : "Google sign-in failed");
      void navigate({ to: ROUTE_PATH, search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.google]);

  const connect = useMutation({
    mutationFn: async () =>
      await startConnect({
        data: {
          organizationId: organizationId!,
          service: "google_ads",
          origin: window.location.origin,
          returnPath: ROUTE_PATH,
        },
      }),
    onSuccess: (res: any) => {
      window.location.href = res.authUrl;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discover = useMutation({
    mutationFn: async () => await discoverFn({ data: { organizationId: organizationId! } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const account = discover.data?.accounts.find((a: any) => a.customerId === chosen);
      if (!account) throw new Error("Choose an account first.");
      if (account.manager) throw new Error("Choose a client account, not a manager account.");
      return await selectFn({
        data: {
          organizationId: organizationId!,
          customerId: account.customerId,
          managerCustomerId:
            account.viaManagerId && account.viaManagerId !== account.customerId
              ? account.viaManagerId
              : null,
          accountName: account.descriptiveName,
        },
      });
    },
    onSuccess: () => {
      toast.success("Google Ads account saved");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => await testFn({ data: { organizationId: organizationId! } }),
    onSuccess: () => {
      toast.success("Google Ads connection is working");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pull = useMutation({
    mutationFn: async () =>
      await pullFn({ data: { organizationId: organizationId!, days: 7, includeBreakdowns: true } }),
    onSuccess: () => {
      toast.success("Validation pull complete");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
      void summary.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: async () =>
      await disconnect({ data: { organizationId: organizationId!, service: "google_ads" } }),
    onSuccess: () => {
      toast.success("Google Ads access removed. Stored validation rows were kept.");
      void qc.invalidateQueries({ queryKey: ["google_connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!organizationId) {
    return (
      <EmptyState
        title="Select an organization"
        description="Choose an organization to manage this connection."
      />
    );
  }

  const status = conn?.status ?? "disconnected";
  const currency = conn?.ads_currency_code as string | null;
  const s = summary.data as any;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Ads Connection"
        description="Read-only Google Ads access for validation. Nothing here changes campaigns, and Google Ads data is not used by any dashboard yet."
      />

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusPill
              status={
                status === "connected" ? "connected" : status === "authorized" ? "pending" : "disconnected"
              }
            />
            {conn?.google_account_email ? (
              <span className="text-sm text-muted-foreground">{conn.google_account_email}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={status === "disconnected" ? "default" : "outline"}
              disabled={!canManageImports || connect.isPending || !setup.data?.oauthConfigured}
              onClick={() => connect.mutate()}
            >
              <LinkIcon className="mr-2 size-4" />
              {status === "disconnected" ? "Connect Google Ads" : "Reconnect"}
            </Button>
            {status !== "disconnected" ? (
              <Button
                variant="outline"
                disabled={!canManageImports || unlink.isPending}
                onClick={() => unlink.mutate()}
              >
                <Unplug className="mr-2 size-4" />
                Disconnect
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Google account" value={conn?.google_account_email ?? "—"} />
          <Field
            label="Ads account"
            value={
              conn?.ads_customer_id
                ? `${conn.ads_customer_name ?? "Account"} (${conn.ads_customer_id})`
                : "—"
            }
          />
          <Field label="Manager account" value={conn?.ads_manager_customer_id ?? "Direct access"} />
          <Field label="Currency" value={currency ?? "—"} />
          <Field label="Reporting timezone" value={conn?.ads_time_zone ?? "—"} />
          <Field label="Last successful pull" value={fmtTime(conn?.last_successful_sync_at)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Developer token"
            value={
              setup.data?.developerTokenConfigured ? (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Saved securely{setup.data?.developerTokenHint ? ` (${setup.data.developerTokenHint})` : ""}
                </span>
              ) : (
                <span className="text-destructive">Not saved yet</span>
              )
            }
          />
          <Field label="Authorized redirect URI" value={<code className="text-xs">{redirectUri}</code>} />
          <Field label="Access" value="Read-only reporting" />
        </div>

        {conn?.last_error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{conn.last_error}</p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Account discovery</h2>
            <p className="text-sm text-muted-foreground">
              Lists every Google Ads account the authorized Google user can read. Choose the ONELIFE
              account explicitly — nothing is auto-selected.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!canManageImports || status === "disconnected" || discover.isPending}
              onClick={() => discover.mutate()}
            >
              <RefreshCw className={`mr-2 size-4 ${discover.isPending ? "animate-spin" : ""}`} />
              Discover accounts
            </Button>
            <Button
              variant="outline"
              disabled={!canManageImports || !conn?.ads_customer_id || test.isPending}
              onClick={() => test.mutate()}
            >
              Test connection
            </Button>
          </div>
        </div>

        {discover.data ? (
          <div className="space-y-3">
            {discover.data.accounts.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-left font-medium">Customer ID</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">API reporting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discover.data.accounts.map((a: any) => (
                      <tr key={a.customerId} className="border-t">
                        <td className="px-3 py-2">{a.descriptiveName ?? "Unnamed"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{a.customerId}</td>
                        <td className="px-3 py-2">
                          {a.manager ? "Manager" : "Client"}
                          {a.testAccount ? " (test)" : ""}
                        </td>
                        <td className="px-3 py-2">
                          {a.manager
                            ? "Not selectable"
                            : a.status === "ENABLED"
                              ? "Enabled"
                              : (a.status ?? "Unknown")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No reportable Google Ads accounts were returned for this Google user.
              </p>
            )}

            <div className="grid gap-2 sm:max-w-xl">
              <Label>Google Ads account</Label>
              <Select value={chosen} onValueChange={setChosen}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the ONELIFE Google Ads account" />
                </SelectTrigger>
                <SelectContent>
                  {discover.data.accounts.map((a: any) => (
                    <SelectItem key={a.customerId} value={a.customerId} disabled={a.manager}>
                      {(a.descriptiveName ?? "Unnamed") + ` — ${a.customerId}`}
                      {a.manager ? " (manager)" : ""}
                      {a.testAccount ? " (test)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-fit"
                disabled={!canManageImports || !chosen || save.isPending}
                onClick={() => save.mutate()}
              >
                Save selected account
              </Button>
            </div>
            {(discover.data as any).skipped?.length > 0 ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Skipped accounts</p>
                <ul className="mt-1 space-y-1">
                  {(discover.data as any).skipped.map((s: any) => (
                    <li key={s.customerId}>
                      {s.customerId} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Bounded validation pull</h2>
            <p className="text-sm text-muted-foreground">
              Pulls the last 7 complete days in the account's own timezone (never today's partial day)
              into a separate validation area. No historical backfill, and no dashboard is affected.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={
              !canManageImports ||
              !conn?.ads_customer_id ||
              !setup.data?.developerTokenConfigured ||
              pull.isPending
            }
            onClick={() => pull.mutate()}
          >
            <RefreshCw className={`mr-2 size-4 ${pull.isPending ? "animate-spin" : ""}`} />
            Run validation pull
          </Button>
        </div>

        {s ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Date range" value={`${s.range.start} → ${s.range.end}`} />
              <Field label="Impressions" value={int(s.accountTotals.impressions)} />
              <Field label="Clicks" value={int(s.accountTotals.clicks)} />
              <Field label="Cost" value={money(s.accountTotals.cost, s.currencyCode)} />
              <Field
                label="CTR"
                value={s.accountTotals.ctr == null ? "—" : `${(s.accountTotals.ctr * 100).toFixed(2)}%`}
              />
              <Field label="Avg. CPC" value={money(s.accountTotals.averageCpc, s.currencyCode)} />
              <Field label="Conversions" value={s.accountTotals.conversions.toFixed(2)} />
              <Field
                label="Conversion value"
                value={money(s.accountTotals.conversionsValue, s.currencyCode)}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Stored rows by grain:{" "}
              {Object.entries(s.rowsByGrain)
                .map(([g, n]) => `${g}: ${n}`)
                .join(" · ")}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Impr.</th>
                    <th className="py-2 pr-3 text-right">Clicks</th>
                    <th className="py-2 pr-3 text-right">Cost</th>
                    <th className="py-2 pr-3 text-right">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topCampaigns.map((c: any) => (
                    <tr key={c.campaignId ?? c.campaignName} className="border-b last:border-0">
                      <td className="py-2 pr-3">{c.campaignName ?? c.campaignId}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.status ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">{int(c.impressions)}</td>
                      <td className="py-2 pr-3 text-right">{int(c.clicks)}</td>
                      <td className="py-2 pr-3 text-right">{money(c.cost, s.currencyCode)}</td>
                      <td className="py-2 pr-3 text-right">{c.conversions.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {s.conversionActionMix.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">Conversion action</th>
                      <th className="py-2 pr-3">Category</th>
                      <th className="py-2 pr-3 text-right">Conversions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.conversionActionMix.map((a: any) => (
                      <tr key={a.actionId ?? a.name} className="border-b last:border-0">
                        <td className="py-2 pr-3">{a.name ?? a.actionId}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{a.category ?? "—"}</td>
                        <td className="py-2 pr-3 text-right">{a.conversions.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No validation rows stored yet.</p>
        )}

        {pull.data ? (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(pull.data, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">Guardrails</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Google Ads access is read-only: no campaign, budget or bid can be changed from here.</li>
          <li>
            Validation rows are stored separately and are not canonical. No dashboard, KPI, Search
            Console, GA4, WelcomeHome, Further, occupancy or forecast figure uses them.
          </li>
          <li>Campaigns are not mapped to communities and no cross-source attribution is created.</li>
          <li>All dates follow the Google Ads account's own reporting timezone.</li>
        </ul>
      </section>
    </div>
  );
}
