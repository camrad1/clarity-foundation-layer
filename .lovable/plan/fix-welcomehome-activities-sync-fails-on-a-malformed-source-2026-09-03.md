# Fix: WelcomeHome Activities sync fails on a malformed source date

## What is happening

Every sync run today ends **Partial/Failed** for one reason only: the `Activities` batch is
rejected by the database with

```text
wh_activities: date/time field value out of range: "24-08-08"
```

All other tables (Prospects, HousingContracts, Units, MarketingTouchpoints,
DepositTransactions, Residents, and the lookups) complete successfully, so the connection
shows partial rather than failed.

## Confirmed root cause

At least one WelcomeHome activity carries a nonsense timestamp with a year in the
"double digits" range (year 24 instead of 2024). When ClarityIQ converts that instant to
the community-local calendar date, the date formatter writes the year without padding,
producing the string `24-08-08` instead of `0024-08-08`. The database cannot interpret
`24-08-08` as a calendar date, so the whole 5,000-row batch is rejected — one bad record
blocks the entire Activities table.

Verified: reproducing the conversion with a year-24 instant returns exactly `24-08-08`,
and one already-stored activity row has a local date before 1900.

## The fix

1. **Zero-pad the year** in the local-date conversion so a valid date string is always
   produced (`0024-08-08`), removing the crash entirely.
2. **Quarantine implausible dates.** Any derived local date outside a sane window
   (before 1900 or after 2100) is stored as empty rather than as a garbage date, so
   corrupt source records can never distort weekly/monthly reporting windows. The raw
   source timestamp is still retained on the record for audit.
3. **Do not silently drop the record.** The activity itself still imports; only the
   unusable date field is blanked.
4. **Clean the one existing bad row** so historical reporting windows are not polluted.

## After the fix

Re-run the WelcomeHome sync (or the existing "Retry failed work units" action on the
Sync Run Summary) so the Activities table completes and the run rolls up to **Complete**.

## Technical notes

- `localDate()` in `src/lib/wh/normalize.server.ts`: build the `yyyy-MM-dd` string from
  `formatToParts` with `year.padStart(4, "0")`, and return `null` when the resulting year
  falls outside 1900–2100.
- Affects every consumer of `localDate` (activities, deposits, touchpoints), which is the
  correct blast radius — the same unpadded-year bug exists on all of them.
- One-row data correction for the existing sub-1900 `wh_activities` local date.
- No metric definitions, occupancy logic, or Flash/Forecast behavior change.

## Verification

- Trigger a full WelcomeHome sync; confirm Activities reports success with zero failed
  rows and the run summary shows Complete for every mapped community.
- Confirm activity counts (Tours, Re-Tours, Inquiries, Outreach) reappear for the affected
  communities and no activity carries a pre-1900 date.
