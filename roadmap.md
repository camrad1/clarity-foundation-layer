# ClarityIQ roadmap

## Done
- [ ] Occupancy Capacity Basis (community-level canonical setting)
  - [x] Diagnose Sonnet Hill 52 vs 78 (rooms vs occupancy points)
  - [x] Validate occupied numerator rule against WelcomeHome source data (59 = qualifying contracts, capped at unit points)
  - [x] `communities.occupancy_capacity_basis` = rooms | occupancy_points | configured_capacity (default rooms; Sonnet Hill = occupancy_points)
  - [x] Canonical census layer exposes rooms, occupancy-point capacity, configured capacity, canonical capacity + basis, occupied rooms, occupied capacity
  - [x] Snapshot metadata: capacity_basis, metric_version, census_rooms, census_capacity, occupied_rooms, occupied_capacity; mark room-basis Sonnet snapshots noncanonical
  - [x] Data Health: Configured | Rooms | Occupancy points | Canonical basis + mismatch flags
  - [x] Downstream parity: Flash, Occupancy Intelligence, Sales Intelligence, nightly snapshots, projections, history, CSV/PDF

## Not started
- [ ] Reconcile capacity basis individually for Belmare, The Esther, The Rawlin, Vineyard Henderson
- [ ] Optimize `wh_sales_summary` / `wh_sales_trend` (statement timeouts on Sales Intelligence)
