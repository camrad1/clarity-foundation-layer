-- Performance hardening for heavy Sales Intelligence report functions.
-- No metric-definition or calculation changes:
--   1) Both functions run far over the API role's 8s statement_timeout after the
--      historical import grew the data; allow them up to 60s for the request.
--   2) wh_sales_summary computed wh_flash_occupancy twice with identical args;
--      compute it once into a variable and reuse the same value.

DO $patch$
DECLARE
  src text;
  orig text;
  sec text;
  res text;
BEGIN
  -- ---------- wh_sales_summary ----------
  SELECT p.prosrc,
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
    INTO src, sec
    FROM pg_proc p
   WHERE p.proname = 'wh_sales_summary'
     AND p.pronamespace = 'public'::regnamespace;
  orig := src;

  -- 1) request-scoped statement timeout for this heavy report
  src := replace(
    src,
    E'  END IF;\n\n  SELECT array_agg(c.id) INTO scope',
    E'  END IF;\n\n  -- Heavy executive report: allow up to 60s for this request (default role limit is 8s).\n  PERFORM set_config(''statement_timeout'', ''60s'', true);\n\n  SELECT array_agg(c.id) INTO scope'
  );
  IF src = orig THEN
    RAISE EXCEPTION 'wh_sales_summary patch anchor 1 not found';
  END IF;

  -- 2) compute occupancy once instead of twice (identical arguments)
  orig := src;
  src := replace(src, E'  pseudo_patterns text[];\nBEGIN', E'  pseudo_patterns text[];\n  v_occ jsonb;\nBEGIN');
  IF src = orig THEN RAISE EXCEPTION 'wh_sales_summary patch anchor 2 not found'; END IF;

  orig := src;
  src := replace(
    src,
    E'  scope := COALESCE(scope, ARRAY[]::uuid[]);',
    E'  scope := COALESCE(scope, ARRAY[]::uuid[]);\n  v_occ := public.wh_flash_occupancy(_org_id, scope);'
  );
  IF src = orig THEN RAISE EXCEPTION 'wh_sales_summary patch anchor 3 not found'; END IF;

  orig := src;
  src := replace(src, E'''occupancy'', public.wh_flash_occupancy(_org_id, scope)', E'''occupancy'', v_occ');
  IF src = orig THEN RAISE EXCEPTION 'wh_sales_summary patch anchor 4 not found'; END IF;

  orig := src;
  src := replace(
    src,
    E'''occupiedUnitsCandidate'', (public.wh_flash_occupancy(_org_id, scope)->>''occupiedUnits'')::int',
    E'''occupiedUnitsCandidate'', (v_occ->>''occupiedUnits'')::int'
  );
  IF src = orig THEN RAISE EXCEPTION 'wh_sales_summary patch anchor 5 not found'; END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.wh_sales_summary(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb LANGUAGE plpgsql %s SET search_path = public AS $f$%s$f$',
    sec, src
  );

  -- ---------- wh_sales_trend ----------
  SELECT p.prosrc,
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END,
         pg_get_function_result(p.oid)
    INTO src, sec, res
    FROM pg_proc p
   WHERE p.proname = 'wh_sales_trend'
     AND p.pronamespace = 'public'::regnamespace;
  orig := src;

  src := replace(
    src,
    E'  END IF;',
    E'  END IF;\n\n  -- Heavy executive report: allow up to 60s for this request (default role limit is 8s).\n  PERFORM set_config(''statement_timeout'', ''60s'', true);'
  );
  IF src = orig THEN
    RAISE EXCEPTION 'wh_sales_trend patch anchor not found';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.wh_sales_trend(_org_id uuid, _end date, _months integer DEFAULT 12, _community_ids uuid[] DEFAULT NULL::uuid[]) RETURNS %s LANGUAGE plpgsql %s SET search_path = public AS $f$%s$f$',
    res, sec, src
  );
END
$patch$;