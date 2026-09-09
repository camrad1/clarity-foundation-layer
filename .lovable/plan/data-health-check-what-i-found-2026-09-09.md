# Data Health check — what I found

Short answer: the page itself is reporting honestly, but the data behind it is not all current. Three sources have stopped updating.

## Current state (checked directly in the database today, Sep 9)

| Source | Newest data | Status |
| --- | --- | --- |
| WelcomeHome occupancy (units, housing contracts) | today, hourly | Healthy |
| WelcomeHome prospects / inquiries | Sep 3 | Stalled |
| WelcomeHome activities / tours | Sep 5 | Stalled |
| Further conversations & lead details | today | Healthy |
| Further leads | Sep 5 | Failing — Further returns an error on every attempt |
| Google Search Console | Sep 2 | No refresh schedule exists |
| Google Analytics 4 | Sep 4 | No refresh schedule exists |
| Google Ads | Sep 6 | No refresh schedule exists |

Why: the only automatic jobs running are the hourly occupancy snapshot and the Further hourly/nightly pull. Prospects, activities and all three Google sources were loaded by one-off backfills and were never put on a schedule. Separately, the Further leads pull has been returning an error since Sep 5 while its other datasets keep working.

Consequence: sales figures (inquiries, tours, move-ins), marketing traffic and paid media are effectively frozen at last week's numbers, while occupancy is current. Anyone comparing them today is mixing fresh and stale periods.

## Proposed work

1. **Fix Further leads.** Probe the leads endpoint with the exact parameters the scheduled run sends, identify the rejected parameter (most likely the incremental timestamp format), correct it, and confirm a clean incremental run. No change to matching or lead definitions.
2. **Schedule the stalled WelcomeHome tables.** Add prospects and activities to a recurring incremental sync using the existing hardened chunked sync path, same as occupancy already uses — no new ingestion logic, no metric changes.
3. **Schedule the Google sources.** Add recurring incremental pulls for Search Console, GA4 and Google Ads using the existing backfill/sync functions, each respecting its own reporting lag (Search Console finalizes a few days in arrears) and writing only to its existing fact layer.
4. **Make staleness visible on Data Health.** Each source section gets an explicit "stale — no successful refresh in X" warning, and the Further section surfaces the failing dataset's error text instead of only a general status. Currently a source can be days behind while the page still looks calm.
5. **Backfill the gap.** Once schedules run, fill Sep 2–9 for each affected source and reconcile the recovered days against the existing canonical views before treating them as current.

## Technical notes

- Cron jobs today: `wh-nightly` (hourly, occupancy snapshots only), `further-sync` hourly and nightly. No Google cron exists.
- `further_sync_state.leads` holds `Further responded 400 on /api/v1/leads/.` with watermark `2026-09-05 04:20:44.474+00`; the last clean run was a full pull with no watermark, so the incremental date parameter is the prime suspect (to be confirmed, not assumed).
- New schedules call existing public hook routes with the cron token pattern already in use; no new ingestion architecture.
- No metric definitions, mappings, attribution rules or canonical layers change.

## Guardrails

Nothing is overwritten. All refreshes are additive to existing fact tables with provenance preserved, and recovered days are validated against current canonical views before being trusted.
