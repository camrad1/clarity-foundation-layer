ALTER FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) SET statement_timeout = '55s';
ALTER FUNCTION public.wh_current_occupancy(uuid, uuid[]) SET statement_timeout = '55s';
ALTER FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) SET statement_timeout = '55s';
ALTER FUNCTION public.gsc_api_page_report(uuid, date, date, date, date, uuid, integer) SET statement_timeout = '55s';