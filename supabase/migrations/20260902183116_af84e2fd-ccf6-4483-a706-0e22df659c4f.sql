REVOKE ALL ON FUNCTION public.wh_resolve_activity_result_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_deposit_page(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wh_data_completeness(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_deposit_page(uuid, date, date, uuid[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_data_completeness(uuid, uuid[]) TO authenticated, service_role;