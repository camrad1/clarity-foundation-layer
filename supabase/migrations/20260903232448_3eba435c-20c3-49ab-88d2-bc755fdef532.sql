CREATE OR REPLACE FUNCTION public.wh_sync_reap_stalled(_org_id uuid, _stall_minutes integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(mins => GREATEST(COALESCE(_stall_minutes, 10), 1));
  stalled_units integer := 0;
  finalized jsonb := '[]'::jsonb;
  r record;
  v_ok integer;
  v_bad integer;
  v_seen integer;
  v_planned integer;
  v_status text;
  v_note text;
BEGIN
  UPDATE public.wh_sync_table_runs u
     SET status = 'stalled',
         completed_at = now(),
         last_error = COALESCE(u.last_error,
           format('No page or row progress since %s', to_char(COALESCE(u.last_progress_at, u.started_at), 'YYYY-MM-DD HH24:MI UTC'))),
         error_summary = COALESCE(u.error_summary,
           format('Stalled after %s minute(s) without progress (page %s, %s row(s) processed)',
                  GREATEST(COALESCE(_stall_minutes, 10), 1), COALESCE(u.current_page, u.pages_processed), u.rows_processed)),
         duration_ms = COALESCE(u.duration_ms, (EXTRACT(epoch FROM (now() - u.started_at)) * 1000)::int)
   WHERE u.organization_id = _org_id
     AND u.status IN ('pending', 'running')
     AND COALESCE(u.last_progress_at, u.started_at) < cutoff;
  GET DIAGNOSTICS stalled_units = ROW_COUNT;

  FOR r IN
    SELECT s.id, s.connection_id, COALESCE((s.sync_cursor->>'totalUnits')::int, 0) AS planned
      FROM public.source_sync_runs s
     WHERE s.organization_id = _org_id
       AND s.status IN ('queued', 'running')
       AND GREATEST(
             s.started_at,
             COALESCE((SELECT max(COALESCE(u.last_progress_at, u.completed_at, u.started_at))
                         FROM public.wh_sync_table_runs u
                        WHERE u.sync_run_id = s.id), s.started_at)
           ) < cutoff
  LOOP
    SELECT count(*) FILTER (WHERE status IN ('success', 'unsupported')),
           count(*) FILTER (WHERE status IN ('failed', 'partial', 'stalled')),
           count(*)
      INTO v_ok, v_bad, v_seen
      FROM (
        SELECT DISTINCT ON (source_table, COALESCE(community_id::text, '*')) status
          FROM public.wh_sync_table_runs
         WHERE sync_run_id = r.id
         ORDER BY source_table, COALESCE(community_id::text, '*'), started_at DESC
      ) latest;

    v_planned := GREATEST(r.planned, v_seen);
    v_status := CASE
      WHEN v_ok = 0 THEN 'failed'
      WHEN v_bad > 0 OR v_ok < v_planned THEN 'partial'
      ELSE 'success'
    END;
    v_note := format('Finalized automatically: no work-unit progress for %s minute(s). %s of %s planned unit(s) completed successfully, %s failed/stalled, %s never started.',
                     GREATEST(COALESCE(_stall_minutes, 10), 1), v_ok, v_planned, v_bad, GREATEST(v_planned - v_seen, 0));

    UPDATE public.source_sync_runs
       SET status = v_status::public.sync_run_status,
           completed_at = now(),
           error_summary = left(COALESCE(error_summary || ' | ', '') || v_note, 1000)
     WHERE id = r.id;

    IF v_status <> 'success' THEN
      UPDATE public.data_source_connections
         SET status = 'needs_attention'
       WHERE id = r.connection_id
         AND organization_id = _org_id;
    ELSE
      UPDATE public.data_source_connections
         SET status = 'connected'
       WHERE id = r.connection_id
         AND organization_id = _org_id
         AND status = 'syncing';
    END IF;

    finalized := finalized || jsonb_build_object(
      'run_id', r.id, 'status', v_status, 'successful', v_ok,
      'failed_or_stalled', v_bad, 'planned', v_planned, 'never_started', GREATEST(v_planned - v_seen, 0));
  END LOOP;

  RETURN jsonb_build_object('stalled_units', stalled_units, 'finalized_runs', finalized);
END;
$$;

REVOKE ALL ON FUNCTION public.wh_sync_reap_stalled(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wh_sync_reap_stalled(uuid, integer) TO service_role;