import { PageHeader } from "./page-header";

export function SectionPlaceholder({
  eyebrow,
  title,
  description,
  planned,
  dependsOn,
}: {
  eyebrow: string;
  title: string;
  description: string;
  planned: string[];
  dependsOn: string[];
}) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-5">
          <p className="eyebrow">Planned in a later phase</p>
          <ul className="mt-3 space-y-2">
            {planned.map((p) => (
              <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                {p}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-5">
          <p className="eyebrow">Depends on</p>
          <ul className="mt-3 space-y-2">
            {dependsOn.map((p) => (
              <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                {p}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-sm text-muted-foreground">
        No figures are shown here because no source data has been connected and no metric
        definition has been validated yet.
      </p>
    </div>
  );
}
