import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Search Intelligence — ONELIFE Marketing Performance Hub" },
      {
        name: "description",
        content:
          "Google Search Console visibility, query intent and page performance for your communities.",
      },
      { property: "og:title", content: "Search Intelligence — ONELIFE Marketing Performance Hub" },
      {
        property: "og:description",
        content: "Organic visibility, query intelligence and page performance across your portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MarketingLayout,
});

const TABS = [
  { to: "/marketing/insights", label: "Insights" },
  { to: "/marketing", label: "Search Overview" },
  { to: "/marketing/queries", label: "Query Intelligence" },
  { to: "/marketing/pages", label: "Page Intelligence" },
  { to: "/marketing/segments", label: "Segments" },
  { to: "/marketing/opportunities", label: "Opportunities" },
];

function MarketingLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b border-border pb-px">
        {TABS.map((t) => {
          const active = pathname === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
