REVOKE EXECUTE ON FUNCTION public.wh_person_label(uuid, text, text) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wh_snapshot_asof(uuid, uuid[], date, integer) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wh_occupancy_asof(uuid, uuid[], date, integer) FROM authenticated, anon, PUBLIC;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;