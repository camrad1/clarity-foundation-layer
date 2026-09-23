import { createFileRoute } from "@tanstack/react-router";
import { AdminGate } from "@/components/clarity/admin-gate";
import { GoogleAdsConnectionPage } from "@/components/clarity/google-ads-connection";

export const Route = createFileRoute("/_authenticated/admin/google-ads-connection")({
  head: () => ({
    meta: [
      { title: "Google Ads Connection — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Authorize read-only Google Ads access, choose the ONELIFE account and run a bounded validation pull without changing any dashboard.",
      },
      { property: "og:title", content: "Google Ads Connection — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Read-only Google Ads account selection and bounded validation pull.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminGate capability="imports" title="Google Ads Connection">
      <GoogleAdsConnectionPage />
    </AdminGate>
  ),
});
