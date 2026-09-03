# Withhold occupancy when a community's unit inventory is incomplete

## What's actually wrong

Sonnet Hill Senior Living is configured in Admin → Communities with **78 units**, but the WelcomeHome sync returns only **52 unit records** (22 Memory Care, rooms 201–222; 30 Assisted Living, rooms 301–330). The Units sync ran full, received 52 rows, and reported 0 failures and 0 unmapped rows, and only one WelcomeHome community (id 20636) is mapped. So roughly 26 units — most likely a whole floor or wing — are missing from WelcomeHome itself, not from the sync.

Because Flash uses the WelcomeHome census as the denominator, Sonnet Hill's occupancy percentage is currently computed against 52 instead of the true 78, which overstates occupancy for that community and quietly distorts portfolio totals.

Confirmed decisions: 78 is correct, and Flash should withhold occupancy for a community whose inventory is materially incomplete rather than report a wrong percentage.

## Approach

Introduce a single canonical "inventory incomplete" rule in the database occupancy layer, and have Flash (and current-occupancy consumers) withhold occupancy for any community that trips it.

Rule: a community's inventory is incomplete when it has a configured unit count and
`configured_units - census_units` exceeds a tolerance. Tolerance is a percentage of the configured count, stored in org settings, defaulting to 5%.

Against today's data this withholds only Sonnet Hill (26 units short, 33%). The other three small variances stay reported: The Rawlin +3 (4.2%), The Esther +1 (1%), Vineyard −1 (1.6%).

Community-level effect when withheld:
- Occupied units, census units, OCC %, budget variance, budget %, projected occupied units and projected OCC % all render as `—`.
- Move-in / move-out / notice / inquiry / tour counts are unaffected — those are event metrics and stay accurate.
- The row carries a clear reason: "Occupancy withheld — unit inventory incomplete (52 of 78 units in WelcomeHome)".

Portfolio-level effect:
- Withheld communities are excluded from the portfolio occupancy numerator and denominator, so the total stays internally consistent rather than being silently understated.
- The portfolio occupancy figure is labeled as covering N of M communities, with the excluded community named in a tooltip, matching the existing "communities covered / complete" pattern already carried in the Flash occupancy payload.

## Where it surfaces

- **Flash Report** — Current Summary occupancy block, week-by-week occupancy and projected month-end columns, and the coverage note. CSV / print / PDF exports carry the same `—` and the same coverage caveat.
- **Occupancy reconciliation panel** (Data Health) — upgrade the existing discrepancy warning so a withheld community is visually distinct from a tolerated minor variance, and state the withheld reason.
- **Admin → Communities** — show the source unit-record count next to the configured count so the gap is visible where the configured number is edited.

## Technical notes

- Database migration updating `wh_current_occupancy`, `wh_snapshot_asof` / `wh_flash_occupancy`, and `wh_flash_report` to compute an `inventory_incomplete` flag per community, null out occupancy fields for flagged communities, and exclude them from the aggregate roll-up while reporting `communities_covered` / `communities_requested`.
- Add `occupancy_inventory_tolerance_pct` to `wh_settings` (default `0.05`), so the threshold is data-driven rather than hard-coded.
- Projected month-end occupancy follows the same gate — no projection is produced from an incomplete denominator.
- Extend `FlashOccupancy` / `CommunityOccupancy` types in `src/lib/flash/queries.ts` and `src/lib/wh/occupancy.ts` with the flag plus counts, then render the withheld state in `src/routes/_authenticated/flash.tsx` and `src/components/clarity/occupancy-reconciliation.tsx`.
- No validated KPI definitions change; move-in/move-out/notice/deposit predicates are untouched.

## Verification

- Sonnet Hill shows `—` for all occupancy and projected-occupancy fields on Flash, with the withheld reason visible.
- The Rawlin, The Esther and Vineyard continue to report occupancy normally.
- Portfolio occupancy recomputed excluding Sonnet Hill, with a "11 of 12 communities" coverage note.
- CSV, print and PDF match the on-screen values.
- Once WelcomeHome contains all 78 Sonnet Hill units, the community reports normally again with no further code change.
