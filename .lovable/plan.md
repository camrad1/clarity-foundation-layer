# Phase 1 Search Console Correction Pass

Scope: fix the seven issues below, then run the Phase 1 test matrix. No Phase 2 / WelcomeHome work.

## What I verified first

- Metric registry: the seven `gsc.*` metrics exist once each at version 1, provisional/unvalidated, already with `source_type = search_console`, but `source_table`, `date_field` and `calculation_definition` are empty (the Phase 1 migration used the wrong key `google_search_console`, so its definition payload never landed on the live rows).
- `gsc_classify_query()` wraps its lookup in `COALESCE(..., 'other')`, so unmatched queries come back as Other. The Query Intelligence UI already handles `null` as "Unclassified", so only the database function (and the report functions' return types) need changing.
- Data Health builds Search Console coverage from `gsc_imports` rows with status `imported`, ignoring whether their grains are still active — superseded periods can inflate the range.
- The imports screen gates on `isOrgAdmin`, while the database helper `can_manage_imports()` also allows `marketing_user`.
- `runGscImport()` inserts fact rows first, then inserts grain rows (which fire the supersede trigger) and only then marks the import `imported` — so the supersede ordering is already safe, but failed imports leave orphan fact rows behind and the final connection-freshness update needs admin-level rights.

## 1. Validation Center — Search Console workflow

Add a Search Console section to the Validation Center:

- Pick connection → Dates-grain import → period → metric (`gsc.clicks`, `gsc.impressions`, `gsc.ctr`, `gsc.avg_position`).
- ClarityIQ value is computed with the same deterministic logic Search Overview uses (`gsc_daily_totals`): summed clicks, summed impressions, clicks ÷ impressions, impression-weighted position.
- Source value is derived from the selected import's own Dates rows (the exported file as uploaded), so no re-typing; if the selected import has no Dates grain, the source value stays blank and must be entered manually rather than guessed.
- Table shows metric, import/file, period, calculated, source, difference, status, notes; the check is written to `metric_validation_checks` with reviewer and timestamp.
- Matching a single period never flips the registry metric to validated — promotion stays a separate, explicit admin action.

## 2. Metric registry correction

One migration that updates the existing version-1 provisional rows in place (allowed by the immutability guard because they are provisional/unvalidated). No new keys, no new versions:

- Keep `source_type = search_console`; fill `source_table = gsc_daily_facts`, `date_field = date`, deterministic `calculation_definition`, `exclusion_rules` (active Dates grains only), and `supported_dimensions` for the first four metrics.
- Classification-dependent metrics (`branded`, `local_intent`, `informational` clicks) keep `gsc_query_facts` as source, stay provisional, and are documented as available only when rules exist.

## 3. Unclassified semantics

- `gsc_classify_query()` returns `NULL` when no rule matches; `other` only when a rule says so.
- `gsc_query_report()` return type allows a null classification; TypeScript types regenerate accordingly.
- UI copy stays as-is (it already renders null as Unclassified) with a check that the "no rules matched" message and the segment tiles read correctly with zero rules.

## 4. Data Health active coverage

- Coverage is computed from `gsc_import_grains` where `is_active`, joined to non-failed imports.
- Panel shows per-grain coverage (grain, period, row count, source file, last import) plus a clearly labelled "Dates report coverage" used by Search Overview.
- Import History keeps showing superseded imports, marked as superseded, but they no longer contribute to active coverage.

## 5. marketing_user import permissions

- Imports screen gates on a new `canManageImports` check (platform admin, organization admin, or marketing_user in the current organization) instead of `isOrgAdmin`; the sidebar link follows the same rule. No other admin screen changes.
- Connection freshness after import moves out of a direct table update into a narrow security-definer function (`gsc_complete_import`) that only marks a permitted import complete and stamps `last_successful_sync_at` / `data_through_date` on that one connection, re-checking `can_manage_imports()` internally. RLS is not broadened.

## 6. Import failure consistency

- Grain rows are still inserted only after all fact rows are written, so supersede cannot run for an import that later fails.
- On failure, the import is marked `failed` and its fact rows are deleted (best-effort cleanup) so nothing orphaned can be picked up later.
- Read paths are audited to confirm every dashboard query joins active grains of non-failed imports; the simple grains (devices/countries/search appearance) get the same guard as the daily path.

## 7. RPC tenant safety

- All six `gsc_*` functions stay SECURITY INVOKER, so RLS remains authoritative and passing a foreign `_org_id` simply returns nothing.
- Where both `_org_id` and `_import_id` are supplied, add an explicit ownership condition so an import from another organization can never be read through a matching org filter.
- `gsc_apply_page_mappings()` is confirmed invoker and constrained to rows the caller can already write.

## 8. Test matrix

Run and report PASS/FAIL for the imports, grains, metrics, classification, mapping, security and validation groups you listed, using SQL role simulation for the RLS items and real sample exports for parsing. Any failure is reported rather than papered over.

## Technical notes

- Migrations: one for the metric registry payload, one for `gsc_classify_query` + report return types, one for `gsc_complete_import`.
- Frontend touchpoints: `admin/validation.tsx`, `admin/gsc-imports.tsx`, `data-health.tsx`, `components/clarity/app-shell.tsx`, `lib/gsc/import.ts`, `lib/gsc/queries.ts`, `lib/clarity-queries.ts`.
