CREATE OR REPLACE FUNCTION public.google_roll_forward_chunks()
RETURNS TABLE (service text, created integer, reopened integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service text;
  v_cutoff date;
  v_created integer;
  v_reopened integer;
BEGIN
  FOR v_service IN SELECT DISTINCT c.service FROM public.google_backfill_chunks c LOOP
    -- GA4 finalizes a day late; keep partial days out of the canonical layer.
    v_cutoff := CASE WHEN v_service = 'ga4' THEN current_date - 2 ELSE current_date - 1 END;

    -- 1. Create any missing month chunks between the newest existing month and the cutoff.
    WITH latest AS (
      SELECT DISTINCT ON (organization_id, connection_id, property_id, grain)
             organization_id, connection_id, property_id, grain, period_start
        FROM public.google_backfill_chunks
       WHERE service = v_service
       ORDER BY organization_id, connection_id, property_id, grain, period_start DESC
    ), months AS (
      SELECT l.*, gs::date AS m
        FROM latest l
        CROSS JOIN LATERAL generate_series(
          date_trunc('month', l.period_start),
          date_trunc('month', v_cutoff::timestamp),
          interval '1 month') gs
    )
    INSERT INTO public.google_backfill_chunks
      (organization_id, connection_id, service, property_id, grain, period_start, period_end, status)
    SELECT organization_id, connection_id, v_service, property_id, grain, m,
           LEAST((m + interval '1 month - 1 day')::date, v_cutoff), 'pending'
      FROM months
     WHERE m > date_trunc('month', period_start)::date
    ON CONFLICT (organization_id, property_id, grain, period_start) DO NOTHING;
    GET DIAGNOSTICS v_created = ROW_COUNT;

    -- 2. Reopen the trailing revision window and extend it to the cutoff.
    UPDATE public.google_backfill_chunks
       SET status = 'pending',
           attempts = 0,
           last_error = NULL,
           period_end = LEAST((date_trunc('month', period_start) + interval '1 month - 1 day')::date, v_cutoff)
     WHERE service = v_service
       AND status <> 'running'
       AND period_end >= v_cutoff - 21
       AND period_start <= v_cutoff;
    GET DIAGNOSTICS v_reopened = ROW_COUNT;

    service := v_service; created := v_created; reopened := v_reopened;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.google_roll_forward_chunks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_roll_forward_chunks() TO service_role;

SELECT cron.unschedule('google-recent-reopen');
SELECT cron.schedule('google-roll-forward', '15 8 * * *', $$SELECT public.google_roll_forward_chunks();$$);