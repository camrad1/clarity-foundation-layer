# Fix: Flash week-by-week "Units" shows 52 for Sonnet Hill

## What's wrong

The week-by-week grid's first occupancy column renders `occupancy.totalUnits`, which is the count of **physical unit records** (52 rooms for Sonnet Hill), not the community's canonical census capacity (78 occupancy points).

Confirmed:
- Sonnet Hill capacity basis is `occupancy_points`, configured units 78.
- The Flash occupancy payload exposes both `totalUnits` (52 raw unit records) and `censusUnits` (78 canonical census), and the grid picks the former.
- Historical rows sourced from imported daily history already carry 78, so only the rows fed by live/current unit records look wrong — which is why the column reads inconsistently.

The OCC % cell already divides by `censusUnits`, so the displayed 52 disagrees with the percentage on the same row.

## The fix (presentation only)

In `src/routes/_authenticated/flash.tsx`:

- Week rows, the month row and the Starting row use the canonical census capacity for the Units column instead of the raw unit-record count, falling back to the portfolio canonical census when a row has no occupancy object.
- Care-type cells continue to use the already-canonical `units`/`occupied` pair from `byCareType` (these follow the community basis).
- Apply the same substitution in the CSV, print and PDF export helpers so screen and exports match.
- No change to server functions, KPI definitions, occupancy math, or any percentage formula.

## Verification

- Sonnet Hill scope: every week row Units reads 78, OCC % consistent with occupied/78.
- Portfolio scope: Units equals the sum of canonical census across communities (rooms-basis communities unchanged).
- Screen, CSV, Print and PDF show identical values.
