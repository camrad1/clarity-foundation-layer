ALTER FUNCTION public.journey_community_matrix(uuid, date, date, uuid[]) SET statement_timeout TO '55s';
ALTER FUNCTION public.journey_further_stage(uuid, date, date, uuid[]) SET statement_timeout TO '55s';
ALTER FUNCTION public.journey_stage_series(uuid, date, date, text, uuid[]) SET statement_timeout TO '55s';