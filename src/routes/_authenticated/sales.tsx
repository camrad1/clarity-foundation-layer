import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/components/clarity/section-placeholder";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "Sales Intelligence — ClarityIQ" },
      {
        name: "description",
        content: "Lead, tour, deposit and move-in performance sourced from your CRM.",
      },
      { property: "og:title", content: "Sales Intelligence — ClarityIQ" },
      {
        property: "og:description",
        content: "Pipeline and conversion performance across the sales funnel.",
      },
    ],
  }),
  component: () => (
    <SectionPlaceholder
      eyebrow="Sales"
      title="Sales Intelligence"
      description="Inquiries, tours, deposits and conversion performance, calculated from CRM records rather than re-keyed reports."
      planned={[
        "Funnel from inquiry through move-in with cohort-correct conversion",
        "Pipeline stage distribution using daily snapshots",
        "Stalled and hot prospect attention lists",
        "Drill-through from every KPI to its contributing records",
      ]}
      dependsOn={[
        "WelcomeHome connection and synchronization",
        "Community source mappings for every WelcomeHome community",
        "Validated wh.* metric definitions",
      ]}
    />
  ),
});
