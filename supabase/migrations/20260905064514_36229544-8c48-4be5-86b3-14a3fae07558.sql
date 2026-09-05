CREATE OR REPLACE FUNCTION public.further_norm_id(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _v IS NULL OR btrim(_v) = '' THEN NULL
    WHEN btrim(_v) ~ '^[0-9]+$' THEN (btrim(_v))::numeric::text
    ELSE btrim(_v)
  END;
$$;

REVOKE ALL ON FUNCTION public.further_activate_matches(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.further_match_coverage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.further_activate_matches(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.further_match_coverage(uuid) TO authenticated;