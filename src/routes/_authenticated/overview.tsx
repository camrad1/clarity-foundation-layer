import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/clarity/page-header";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — ClarityIQ" },
      {
        name: "description",
        content:
          "ClarityIQ brings your performance data together so you can see what is driving results.",
      },
      { property: "og:title", content: "Overview — ClarityIQ" },
      {
        property: "og:description",
        content: "The connected performance journey from visibility through occupancy.",
      },
    ],
  }),
  component: Overview,
});

const JOURNEY = [
  { label: "Visibility", note: "Search Console" },
  { label: "Traffic", note: "Website" },
  { label: "Conversations", note: "Further" },
  { label: "Leads", note: "WelcomeHome" },
  { label: "Tours", note: "WelcomeHome" },
  { label: "Deposits", note: "WelcomeHome" },
  { label: "Move-Ins", note: "WelcomeHome" },
  { label: "Occupancy", note: "Snapshots" },
];

function Overview() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ClarityIQ"
        title="Performance intelligence, end to end"
        description="ClarityIQ brings your marketing, CRM, sales and occupancy data together so you can see what is actually driving results — without manually connecting the dots."
      />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">The performance journey</h2>
        <div className="panel overflow-x-auto p-6">
          <ol className="flex min-w-max items-stretch gap-2">
            {JOURNEY.map((step, i) => (
              <li key={step.label} className="flex items-center gap-2">
                <div className="min-w-[9.5rem] rounded-md border border-border bg-background px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{step.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.note}</p>
                </div>
                {i < JOURNEY.length - 1 ? (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Deterministic by design",
            body: "Every KPI is defined once in the metric registry, versioned, and calculated from source records — never estimated.",
          },
          {
            title: "Traceable to the record",
            body: "Metric results carry drill-through references so any number can be opened to the records that produced it.",
          },
          {
            title: "Governed access",
            body: "Organization and community permissions are enforced in the database, not in the interface.",
          },
        ].map((c) => (
          <article key={c.title} className="panel p-5">
            <h3 className="text-sm font-semibold text-foreground">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
          </article>
        ))}
      </section>

      <p className="text-sm text-muted-foreground">
        Dashboards are not yet enabled. Phase 0 establishes the tenancy model, canonical
        communities, source connections, metric registry and validation tooling that every future
        ClarityIQ dashboard will be built on.
      </p>
    </div>
  );
}
