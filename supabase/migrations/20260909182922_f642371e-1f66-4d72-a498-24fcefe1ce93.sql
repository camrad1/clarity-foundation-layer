-- Keep sales CRM datasets fresh on a schedule (bounded work per tick).
SELECT cron.schedule(
  'wh-crm-refresh',
  '35 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ffcd4ad5-5fcf-4b24-aa99-0403342a98db.lovable.app/api/public/hooks/wh-crm-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (SELECT token FROM private.cron_tokens WHERE name = 'wh_nightly')),
    body := '{"maxUnits": 2}'::jsonb
  ) AS request_id;
  $$
);

-- Re-open recent Google periods once a day so newly finalized days are pulled.
SELECT cron.schedule(
  'google-recent-reopen',
  '40 8 * * *',
  $$
  UPDATE public.google_backfill_chunks
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         period_end = LEAST(
           (date_trunc('month', period_start) + interval '1 month - 1 day')::date,
           (current_date - 1)
         )
   WHERE period_end >= current_date - 45
     AND status <> 'running';
  $$
);

-- Drain any pending Google periods, one service per slot.
SELECT cron.schedule(
  'google-refresh-search-console',
  '45 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ffcd4ad5-5fcf-4b24-aa99-0403342a98db.lovable.app/api/public/hooks/google-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (SELECT token FROM private.cron_tokens WHERE name = 'google_backfill')),
    body := '{"service": "search_console", "budgetMs": 40000}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'google-refresh-ga4',
  '50 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ffcd4ad5-5fcf-4b24-aa99-0403342a98db.lovable.app/api/public/hooks/google-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (SELECT token FROM private.cron_tokens WHERE name = 'google_backfill')),
    body := '{"service": "ga4", "budgetMs": 40000}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'google-refresh-ads',
  '55 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ffcd4ad5-5fcf-4b24-aa99-0403342a98db.lovable.app/api/public/hooks/google-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (SELECT token FROM private.cron_tokens WHERE name = 'google_backfill')),
    body := '{"service": "google_ads", "budgetMs": 40000}'::jsonb
  ) AS request_id;
  $$
);
