# Sonnet Hill 52 vs 78: capacity is measured in units, not beds

## What the data shows

WelcomeHome's Units export for Sonnet Hill returns exactly 52 records, and every one of them synced successfully (0 failed, 0 unmapped, all 52 contract unit references resolve). Nothing is missing.

The 52 are **physical apartments**. Sonnet Hill sells several of them as double-occupancy:

| Care type | Floor plan | Rooms | Occupancy points |
|---|---|---|---|
| Assisted Living | AL Private Studio | 21 | 21 |
| Assisted Living | AL-Neighborly Suite | 9 | 18 |
| Memory Care | MC Private Studio | 5 | 5 |
| Memory Care | MC-Companion Suite | 17 | 34 |
| **Total** | | **52** | **78** |

52 rooms = **78 occupancy points**, which is exactly the 78 configured in Admin and the 78 total_units in the imported occupancy history.

The same split shows on the occupied side: 59 current/notice contracts occupying 46 distinct rooms. WelcomeHome and the Monday spreadsheet report ~60/78 (residents over beds); ClarityIQ reports 46/52 (rooms over rooms). Both are internally consistent — they are two different denominators.

So the discrepancy is a **capacity-basis mismatch**, not a data loss. Every ClarityIQ occupancy calculation currently counts distinct units and ignores `floor_plan_occupancy_points`.

Portfolio check (configured vs rooms vs points):

- Sonnet Hill: 78 configured, 52 rooms, 78 points — points match
- Belmare: 120 configured, 120 rooms, 127 points — rooms match
- The Esther: 103 configured, 104 rooms, 103 points
- The Rawlin: 72 configured, 75 rooms, 73 points
- Vineyard Henderson: 64 configured, 63 rooms, 64 points
- All others: configured = rooms = points

Sonnet Hill is the only community where the two bases differ materially; the others are small mapping/config drifts worth a separate pass.

## Proposed fix

Make capacity basis explicit and bed-aware, without changing any validated KPI definition.

1. Add an occupancy-basis concept to the census layer: `census_units` (rooms) and `census_capacity` (sum of occupancy points, defaulting to 1 per unit). Occupied gets the same treatment: occupied rooms vs occupied beds (distinct current/notice contracts).
2. Set the canonical reporting basis to **capacity/beds**, so Sonnet Hill reads 59/78 and matches WelcomeHome, the imported history, and the Monday call. Every community whose points equal its room count is unaffected.
3. Surface the drift instead of hiding it: Data Health flags any community where configured `unit_count`, room count, and point capacity disagree (Belmare, The Esther, The Rawlin, Vineyard Henderson today), with both numbers shown.
4. Show rooms and beds side by side on the community detail/Data Health view so the double-occupancy structure is visible rather than surprising.

## Technical notes

- `wh_units.floor_plan_occupancy_points` already carries the multiplier and is populated; `occupancy_point_factor` is 1 per unit and is not the bed count.
- `wh_current_occupancy` and `wh_unit_census_exclusion` currently `SELECT DISTINCT community_id, unit_source_id`; the change is to aggregate `SUM(COALESCE(floor_plan_occupancy_points, 1))` for capacity and count qualifying contracts for occupied beds, keeping the existing exclusion rules (off-census, discarded, pseudo/waitlist units) intact.
- Downstream consumers to keep consistent: `wh_flash_occupancy`, `wh_flash_report`, `wh_occupancy_asof`, `wh_write_daily_snapshot`, and the Occupancy Intelligence queries.
- Snapshots already written on the room basis stay as they are; the change applies going forward, with the historical occupancy import (already bed-based at 78) becoming the aligned comparison rather than the conflicting one.

## Verification

- Sonnet Hill Flash shows 59/78 (~75.6%) instead of 46/52, matching WelcomeHome and the imported history for the same date.
- Battle Creek, Shadow Mountain, Waterhouse Ridge, Woodlake, Middlefield, Laurel, Reserve are numerically unchanged.
- Data Health lists the four capacity-drift communities with configured vs rooms vs beds.
