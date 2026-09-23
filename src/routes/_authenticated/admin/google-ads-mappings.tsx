import { createFileRoute } from "@tanstack/react-router";
import { AdminGate } from "@/components/clarity/admin-gate";
import { GoogleAdsCampaignMappingsPage } from "@/components/clarity/google-ads-campaign-mappings";

export const Route = createFileRoute("/_authenticated/admin/google-ads-mappings")({
  head: () => ({
    meta: [
      { title: "Google Ads Campaign Mappings — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Explicit Google Ads campaign to community mappings, keyed on campaign ID with manual admin corrections and mapping health.",
      },
      {
        property: "og:title",
        content: "Google Ads Campaign Mappings — ONELIFE Marketing Performance Hub",
      },
      {
        property: "og:description",
        content: "Durable campaign ID to canonical community mapping for Google Ads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminGate capability="imports" title="Google Ads Campaign Mappings">
      <GoogleAdsCampaignMappingsPage />
    </AdminGate>
  ),
});
