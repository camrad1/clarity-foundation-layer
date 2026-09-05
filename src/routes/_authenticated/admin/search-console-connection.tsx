import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionPage } from "@/components/clarity/google-connection";

export const Route = createFileRoute("/_authenticated/admin/search-console-connection")({
  head: () => ({
    meta: [
      { title: "Search Console Connection — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Authorize Google Search Console with server-side OAuth, pick the canonical ONELIFE property and monitor read-only sync health.",
      },
      { property: "og:title", content: "Search Console Connection — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Server-side Google OAuth, property selection and Search Console sync status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <GoogleConnectionPage service="search_console" routePath="/admin/search-console-connection" />
  ),
});
