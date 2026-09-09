CREATE OR REPLACE FUNCTION public.google_roll_forward_chunks()
RETURNS TABLE (svc text, created integer, reopened integer)
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
  UPDATE public.google_backfill_chunks
     SET status = 'pending', last_error = 'recovered from stalled run'
   WHERE status = 'running'
     AND coalesce(started_at, created_at) < now() - interval '30 minutes';

  FOR v_service IN SELECT DISTINCT c.service FROM public.google_backfill_chunks c LOOP
    v_cutoff := CASE WHEN v_service = 'ga4' THEN current_date - 2 ELSE current_date - 1 END;

    WITH latest AS (
      SELECT DISTINCT ON (c.organization_id, c.connection_id, c.property_id, c.grain)
             c.organization_id, c.connection_id, c.property_id, c.grain, c.period_start
        FROM public.google_backfill_chunks c
       WHERE c.service = v_service
       ORDER BY c.organization_id, c.connection_id, c.property_id, c.grain, c.period_start DESC
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
    SELECT mm.organization_id, mm.connection_id, v_service, mm.property_id, mm.grain, mm.m,
           LEAST((mm.m + interval '1 month - 1 day')::date, v_cutoff), 'pending'
      FROM months mm
     WHERE mm.m > date_trunc('month', mm.period_start)::date
    ON CONFLICT (organization_id, property_id, grain, period_start) DO NOTHING;
    GET DIAGNOSTICS v_created = ROW_COUNT;

    -- Trailing revision window: 7 days, so a full previous month is never
    -- re-pulled every night.
    UPDATE public.google_backfill_chunks c
       SET status = 'pending',
           attempts = 0,
           last_error = NULL,
           period_end = LEAST((date_trunc('month', c.period_start) + interval '1 month - 1 day')::date, v_cutoff)
     WHERE c.service = v_service
       AND c.status <> 'running'
       AND c.period_end >= v_cutoff - 7
       AND c.period_start <= v_cutoff;
    GET DIAGNOSTICS v_reopened = ROW_COUNT;

    svc := v_service; created := v_created; reopened := v_reopened;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.google_roll_forward_chunks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_roll_forward_chunks() TO service_role;