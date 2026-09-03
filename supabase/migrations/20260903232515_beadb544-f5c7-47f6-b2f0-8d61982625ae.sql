REVOKE ALL ON FUNCTION public.wh_sync_reap_stalled(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wh_sync_reap_stalled(uuid, integer) TO service_role;