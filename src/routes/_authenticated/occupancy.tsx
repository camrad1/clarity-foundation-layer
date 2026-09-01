import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/components/clarity/section-placeholder";

export const Route = createFileRoute("/_authenticated/occupancy")({
  head: () => ({
    meta: [
      { title: "Occupancy Intelligence — ClarityIQ" },
      {
        name: "description",
        content: "Current and projected occupancy performance by community and care type.",
      },
      { property: "og:title", content: "Occupancy Intelligence — ClarityIQ" },
      {
        property: "og:description",
        content: "Occupancy, move-ins, move-outs and projection performance.",
      },
    ],
  }),
  component: () => (
    <SectionPlaceholder
      eyebrow="Occupancy"
      title="Occupancy Intelligence"
      description="Occupancy and projected occupancy, reconstructed from historical events and daily state snapshots."
      planned={[
        "Occupancy and projected occupancy trend by community and care type",
        "Net move-in performance against goals",
        "Point-in-time state reconstruction from daily snapshots",
      ]}
      dependsOn={[
        "Community unit counts and care type assignments",
        "Daily community snapshots being written by the sync pipeline",
        "Validated occupancy metric definitions",
      ]}
    />
  ),
});
