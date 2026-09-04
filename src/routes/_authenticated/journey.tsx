import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/components/clarity/section-placeholder";

export const Route = createFileRoute("/_authenticated/journey")({
  head: () => ({
    meta: [
      { title: "Performance Journey — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "The end-to-end journey from search visibility through occupancy, in one connected view.",
      },
      { property: "og:title", content: "Performance Journey — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Visibility to occupancy, connected stage by stage.",
      },
    ],
  }),
  component: () => (
    <SectionPlaceholder
      eyebrow="Journey"
      title="Performance Journey"
      description="Visibility → Traffic → Conversations → Leads → Tours → Deposits → Move-Ins → Occupancy, with attribution level stated at every stage."
      planned={[
        "Stage-by-stage volume and conversion with declared attribution level",
        "Where performance is being lost between stages",
        "Deterministic signals feeding future Clarity insights",
      ]}
      dependsOn={[
        "All three initial sources connected",
        "Cross-source community resolution through canonical mappings",
        "Validated metric definitions at each stage",
      ]}
    />
  ),
});
