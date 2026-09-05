import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionPage } from "@/components/clarity/google-connection";

export const Route = createFileRoute("/_authenticated/admin/ga4-connection")({
  head: () => ({
    meta: [
      { title: "GA4 Connection — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Authorize Google Analytics 4 with server-side OAuth, pick the canonical ONELIFE property and monitor read-only sync health.",
      },
      { property: "og:title", content: "GA4 Connection — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Server-side Google OAuth, GA4 property selection and sync status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <GoogleConnectionPage service="ga4" routePath="/admin/ga4-connection" />,
});
