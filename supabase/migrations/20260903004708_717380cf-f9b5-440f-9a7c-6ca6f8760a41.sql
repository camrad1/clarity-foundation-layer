CREATE OR REPLACE FUNCTION public.flash_week_start(_d date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _d - (EXTRACT(dow FROM _d)::int)
$function$;