import { useMemo } from "react";
import { useAdminGate } from "@/components/clarity/admin-gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/clarity/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommunities, useOrgRole } from "@/lib/clarity-queries";
import {
  adsCampaignMappings,
  adsSetCampaignMapping,
  type AdsCampaignMappingRow,
} from "@/lib/google/ads-mappings.functions";
import { useAppState } from "@/state/app-state";

const UNMAPPED = "__unmapped__";

const int = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n));

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

const day = (d: string | null) => (d ? format(new Date(`${d}T00:00:00`), "MMM d, yyyy") : "—");

function Stat({ label, value, tone }: { label: string; value: string; tone?: string | undefined }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function HealthBadge({ row }: { row: AdsCampaignMappingRow }) {
  const active = (row.campaign_status ?? "").toUpperCase() === "ENABLED";
  if (row.canonical_community_id) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Mapped
      </Badge>
    );
  }
  if (!active) {
    return (
      <Badge variant="outline" className="gap-1">
        <HelpCircle className="h-3 w-3" /> Unmapped historical
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> Needs mapping
    </Badge>
  );
}

export function GoogleAdsCampaignMappingsPage() {
  const gate = useAdminGate("imports", "Google Ads Campaign Mappings");
  if (gate) return gate;

  const qc = useQueryClient();
  const { organizationId } = useAppState();
  const { canManageImports } = useOrgRole(organizationId);
  const communities = useCommunities(organizationId);

  const listFn = useServerFn(adsCampaignMappings);
  const setFn = useServerFn(adsSetCampaignMapping);

  const query = useQuery({
    queryKey: ["google_ads_campaign_mappings", organizationId],
    enabled: !!organizationId,
    queryFn: async () => await listFn({ data: { organizationId: organizationId! } }),
  });

  const save = useMutation({
    mutationFn: async (vars: { row: AdsCampaignMappingRow; communityId: string | null }) =>
      await setFn({
        data: {
          organizationId: organizationId!,
          googleAdsCustomerId: vars.row.google_ads_customer_id ?? "",
          campaignId: vars.row.campaign_id,
          campaignName: vars.row.campaign_name ?? vars.row.campaign_id,
          communityId: vars.communityId,
        },
      }),
    onSuccess: () => {
      toast.success("Mapping saved");
      void qc.invalidateQueries({ queryKey: ["google_ads_campaign_mappings", organizationId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save mapping"),
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  const communityOptions = useMemo(
    () => (communities.data ?? []).map((c: any) => ({ id: c.id, name: c.name })),
    [communities.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Ads Campaign Mappings"
        description="Explicit campaign ID → community mapping. Campaign names are display only; the app never re-maps a campaign because its name changed."
      />

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Campaigns" value={int(summary.total)} />
          <Stat label="Mapped" value={int(summary.mapped)} />
          <Stat
            label="Unmapped"
            value={int(summary.unmapped)}
            tone={summary.activeUnmapped > 0 ? "text-destructive" : undefined}
          />
          <Stat label="Paused / historical" value={int(summary.historical)} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaigns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Campaign</th>
                  <th className="px-4 py-2 text-left">Campaign ID</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Spend</th>
                  <th className="px-4 py-2 text-left">Last activity</th>
                  <th className="px-4 py-2 text-left">Mapped community</th>
                  <th className="px-4 py-2 text-left">Method</th>
                  <th className="px-4 py-2 text-left">Health</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6">
                      <Skeleton className="h-24 w-full" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No Google Ads campaigns found for this organization.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.campaign_id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{row.campaign_name ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {row.campaign_id}
                      </td>
                      <td className="px-4 py-2">{row.campaign_status ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(row.cost)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{day(row.last_date)}</td>
                      <td className="px-4 py-2">
                        <Select
                          disabled={!canManageImports || save.isPending}
                          value={row.canonical_community_id ?? UNMAPPED}
                          onValueChange={(v) =>
                            save.mutate({ row, communityId: v === UNMAPPED ? null : v })
                          }
                        >
                          <SelectTrigger className="h-8 w-[240px]">
                            <SelectValue placeholder="Unmapped" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>Unmapped (historical)</SelectItem>
                            {communityOptions.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {row.mapping_method ?? "none"}
                      </td>
                      <td className="px-4 py-2">
                        <HealthBadge row={row} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Mappings are keyed on the Google Ads campaign ID. Campaigns whose destination community is
        not part of this organization stay intentionally unmapped rather than being forced onto a
        current community.
      </p>
    </div>
  );
}
