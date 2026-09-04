-- Search Console exports are calendar dates. A spreadsheet-serial parsing bug
-- stored every imported day one calendar day early. Re-derive the stored dates
-- by shifting them forward one day. Timestamp columns are untouched.
-- The daily facts move out of range first so the (import_id, date) uniqueness
-- check never sees a transient collision with an unshifted neighbour.
UPDATE public.gsc_daily_facts SET date = date + 5000;
UPDATE public.gsc_daily_facts SET date = date - 4999;
UPDATE public.gsc_import_grains
   SET period_start = period_start + 1,
       period_end = period_end + 1
 WHERE period_start IS NOT NULL AND period_end IS NOT NULL;
UPDATE public.gsc_imports
   SET data_start_date = data_start_date + 1,
       data_end_date = data_end_date + 1
 WHERE data_start_date IS NOT NULL AND data_end_date IS NOT NULL;