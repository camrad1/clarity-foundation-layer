REVOKE ALL ON FUNCTION public.guard_snapshot_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_occupancy_asof(uuid, uuid[], date, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wh_snapshot_health(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_asof(uuid, uuid[], date, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_snapshot_health(uuid, uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_manage_imports(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_imports(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gsc_complete_import(uuid, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gsc_complete_import(uuid, jsonb, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gsc_discard_failed_import(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gsc_discard_failed_import(uuid, text) TO authenticated, service_role;