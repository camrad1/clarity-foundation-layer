import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ONELIFE Marketing Performance Hub — Senior Living Performance Intelligence" },
      {
        name: "description",
        content:
          "ClarityIQ connects marketing, CRM, sales and occupancy data so operators can see what is actually driving performance.",
      },
      { property: "og:title", content: "ONELIFE Marketing Performance Hub — Performance Intelligence" },
      {
        property: "og:description",
        content:
          "One connected view of visibility, traffic, leads, tours, deposits, move-ins and occupancy.",
      },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
  component: () => null,
});
