CREATE OR REPLACE FUNCTION public.gsc_api_norm_url(_u text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
           WHEN x ~ '^https?://[^/]+/?$' THEN x
           ELSE regexp_replace(x, '/+$', '')
         END
  FROM (SELECT lower(split_part(btrim(_u), '#', 1))) t(x);
$$;

REVOKE EXECUTE ON FUNCTION public.gsc_api_norm_url(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_coverage(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_daily_totals(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_daily_series(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_query_report(uuid, date, date, date, date, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_page_report(uuid, date, date, date, date, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_query_page_report(uuid, date, date, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gsc_api_dimension_report(uuid, date, date, text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.gsc_api_norm_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_daily_totals(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_daily_series(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_query_report(uuid, date, date, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_page_report(uuid, date, date, date, date, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_query_page_report(uuid, date, date, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gsc_api_dimension_report(uuid, date, date, text, integer) TO authenticated;