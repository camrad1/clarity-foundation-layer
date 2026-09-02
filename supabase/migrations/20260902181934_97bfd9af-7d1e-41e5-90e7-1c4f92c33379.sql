REVOKE EXECUTE ON FUNCTION public.wh_successful_result_labels(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.wh_tour_page(uuid, date, date, uuid[], text, integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.wh_successful_result_labels(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_tour_page(uuid, date, date, uuid[], text, integer, integer) TO authenticated, service_role;