CREATE OR REPLACE FUNCTION public.ct_bucket(_d date, _grain text)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _grain
           WHEN 'day' THEN _d
           WHEN 'week' THEN _d - (EXTRACT(dow FROM _d)::int)
           ELSE date_trunc('month', _d)::date
         END;
$function$;