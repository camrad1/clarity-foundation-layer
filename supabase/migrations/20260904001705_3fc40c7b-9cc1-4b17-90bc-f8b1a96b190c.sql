REVOKE EXECUTE ON FUNCTION public.wh_unit_census_rows(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wh_community_capacity(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wh_unit_census_rows(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.wh_community_capacity(uuid, uuid[]) TO service_role;