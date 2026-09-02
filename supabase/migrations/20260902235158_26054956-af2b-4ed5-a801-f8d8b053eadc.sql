DO $mig$
DECLARE def text; a int; b int; newblock text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wh_sales_summary';

  a := strpos(def, '''occupancy'', jsonb_build_object(');
  b := strpos(def, '''stageDistribution''');
  IF a = 0 OR b = 0 OR b <= a THEN
    RAISE EXCEPTION 'occupancy block not located in wh_sales_summary';
  END IF;

  newblock := '''occupancy'', public.wh_flash_occupancy(_org_id, scope)
      || jsonb_build_object(
           ''occupiedUnitsCandidate'', (public.wh_flash_occupancy(_org_id, scope)->>''occupiedUnits'')::int,
           ''pendingMoveIns'', (SELECT count(*)::int FROM k WHERE count_move_in IS TRUE AND mi_date > today)),
    ';

  def := left(def, a - 1) || newblock || substr(def, b);
  EXECUTE def;
END $mig$;
