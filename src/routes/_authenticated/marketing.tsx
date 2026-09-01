import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/components/clarity/section-placeholder";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing Intelligence — ClarityIQ" },
      {
        name: "description",
        content:
          "Search visibility, traffic and demand generation intelligence for your communities.",
      },
      { property: "og:title", content: "Marketing Intelligence — ClarityIQ" },
      {
        property: "og:description",
        content: "Visibility and traffic performance across your community portfolio.",
      },
    ],
  }),
  component: () => (
    <SectionPlaceholder
      eyebrow="Marketing"
      title="Marketing Intelligence"
      description="Visibility and traffic performance — how people find your communities and what that demand is worth."
      planned={[
        "Search visibility by community and query intent",
        "Page and content performance tied to canonical communities",
        "Traffic to conversation conversion",
        "Paid and organic contribution once Ads and GA4 are connected",
      ]}
      dependsOn={[
        "Search Console connection and data import",
        "URL mapping rules resolving pages to communities",
        "Validated gsc.* metric definitions",
      ]}
    />
  ),
});
