/**
 * SERVER ONLY. Historical Search Console backfill.
 *
 * ADDITIVE ONLY. Every row lands in `gsc_api_facts` with
 * source_system = 'google_api'. Manual imports (`gsc_*_facts`), WelcomeHome,
 * Further, occupancy data, mappings and dashboard metrics are never read for
 * writing, never modified and never deleted by this module.
 *
 * The backfill is planned as one chunk per (grain, calendar month) so it can be
 * resumed safely: each chunk is idempotently upserted and marked complete only
 * once its pagination finished.
 */

import { fetchSearchAnalytics, toScFact, type ScGrain } from "./sync.server";

export const BACKFILL_GRAINS: ScGrain[] = [
  "date",
  "query",
  "page",
  "query_page",
  "device",
  "country",
  "search_appearance",
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function monthRanges(start: string, end: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const cur = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    const monthStart = new Date(cur);
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    out.push({
      start: iso(monthStart < new Date(`${start}T00:00:00Z`) ? new Date(`${start}T00:00:00Z`) : monthStart),
      end: iso(monthEnd > last ? last : monthEnd),
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Probes how far back Google will serve finalized rows, then creates one
 * pending chunk per grain and month. Existing chunk rows are left untouched.
 */
export async function planSearchConsoleBackfill(
  admin: any,
  args: { organizationId: string; connectionId: string; propertyId: string; accessToken: string },
): Promise<{ earliest: string; latest: string; months: number; chunksCreated: number }> {
  const today = new Date();
  const probeStart = new Date(today);
  probeStart.setUTCMonth(probeStart.getUTCMonth() - 26);

  const probe = await fetchSearchAnalytics({
    accessToken: args.accessToken,
    property: args.propertyId,
    startDate: iso(probeStart),
    endDate: iso(today),
    grain: "date",
  });
  const dates = probe.rows
    .map((r) => r.keys[0] as string)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) throw new Error("Google returned no finalized rows for the probe window.");

  const earliest = dates[0]!;
  const latest = dates[dates.length - 1]!;
  const months = monthRanges(earliest, latest);

  const rows = months.flatMap((m) =>
    BACKFILL_GRAINS.map((grain) => ({
      organization_id: args.organizationId,
      connection_id: args.connectionId,
      service: "search_console",
      property_id: args.propertyId,
      grain,
      period_start: m.start,
      period_end: m.end,
      status: "pending",
    })),
  );

  const { error } = await admin
    .from("google_backfill_chunks")
    .upsert(rows, {
      onConflict: "organization_id,property_id,grain,period_start",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);

  return { earliest, latest, months: months.length, chunksCreated: rows.length };
}

async function writeChunk(
  admin: any,
  chunk: any,
  accessToken: string,
): Promise<{ rows: number; pages: number; truncated: boolean }> {
  const res = await fetchSearchAnalytics({
    accessToken,
    property: chunk.property_id,
    startDate: chunk.period_start,
    endDate: chunk.period_end,
    grain: chunk.grain as ScGrain,
    maxRows: 400000,
  });

  const payload = res.rows.map((r) => ({
    organization_id: chunk.organization_id,
    connection_id: chunk.connection_id,
    source_system: "google_api",
    property_id: chunk.property_id,
    ...toScFact(chunk.grain as ScGrain, r.keys),
    clicks: Math.round(r.clicks ?? 0),
    impressions: Math.round(r.impressions ?? 0),
    ctr: r.ctr ?? null,
    position: r.position ?? null,
    fetched_at: new Date().toISOString(),
  }));

  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin
      .from("gsc_api_facts")
      .upsert(payload.slice(i, i + 500), {
        onConflict: "organization_id,property_id,grain,date,dim_key",
      });
    if (error) throw new Error(error.message);
  }
  return { rows: payload.length, pages: res.pages, truncated: res.truncated };
}

/**
 * Processes pending chunks inside a time budget. Safe to call repeatedly: a
 * chunk is only marked complete after its pagination finished and its rows were
 * upserted.
 */
export async function runSearchConsoleBackfillSlice(
  admin: any,
  args: { organizationId: string; propertyId: string; accessToken: string; budgetMs?: number },
): Promise<{
  processed: Array<{ grain: string; period: string; rows: number; pages: number; truncated: boolean; error?: string }>;
  remaining: number;
}> {
  const deadline = Date.now() + (args.budgetMs ?? 40_000);
  const processed: any[] = [];

  for (;;) {
    if (Date.now() > deadline) break;
    const { data: pending } = await admin
      .from("google_backfill_chunks")
      .select("*")
      .eq("organization_id", args.organizationId)
      .eq("property_id", args.propertyId)
      .in("status", ["pending", "failed"])
      .lt("attempts", 4)
      .order("period_start", { ascending: false })
      .limit(1);

    const chunk = (pending ?? [])[0];
    if (!chunk) break;

    await admin
      .from("google_backfill_chunks")
      .update({ status: "running", attempts: (chunk.attempts ?? 0) + 1, started_at: new Date().toISOString() })
      .eq("id", chunk.id);

    try {
      const result = await writeChunk(admin, chunk, args.accessToken);
      await admin
        .from("google_backfill_chunks")
        .update({
          status: "complete",
          rows_written: result.rows,
          pages: result.pages,
          truncated: result.truncated,
          last_error: null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", chunk.id);
      processed.push({ grain: chunk.grain, period: chunk.period_start, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("google_backfill_chunks")
        .update({ status: "failed", last_error: message.slice(0, 1000), finished_at: new Date().toISOString() })
        .eq("id", chunk.id);
      processed.push({ grain: chunk.grain, period: chunk.period_start, rows: 0, pages: 0, truncated: false, error: message.slice(0, 300) });
    }
  }

  const { count } = await admin
    .from("google_backfill_chunks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", args.organizationId)
    .eq("property_id", args.propertyId)
    .in("status", ["pending", "failed", "running"]);

  return { processed, remaining: count ?? 0 };
}
