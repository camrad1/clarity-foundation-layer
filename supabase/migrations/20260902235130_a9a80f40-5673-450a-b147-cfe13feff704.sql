CREATE OR REPLACE FUNCTION public.wh_flash_occupancy(_org_id uuid, _scope uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE pseudo_patterns text[]; today date := current_date; res jsonb;
BEGIN
  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY['WAITLIST']::text[]) INTO pseudo_patterns
    FROM (SELECT 1) dd LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  pseudo_patterns := COALESCE(pseudo_patterns, ARRAY['WAITLIST']::text[]);

  WITH u AS (
    SELECT un.source_id, COALESCE(NULLIF(btrim(un.care_type_label), ''), 'Unspecified') AS care_type,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           pseudo_patterns) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id AND un.community_id = ANY(_scope)
  ),
  ue AS (SELECT * FROM u WHERE exclusion_reason IS NULL),
  k AS (
    SELECT hc.unit_source_id,
           lower(COALESCE(hc.financial_status, hc.status, '')) AS occ_status,
           COALESCE(hc.financial_move_in_date, hc.move_in_date) AS mi_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(_scope)
       AND hc.discarded_at IS NULL
  ),
  ko AS (SELECT k.* FROM k WHERE k.unit_source_id IN (SELECT source_id FROM ue)),
  occ AS (SELECT DISTINCT unit_source_id FROM ko WHERE occ_status IN ('current','notice'))
  SELECT jsonb_build_object(
    'asOf', today,
    'basis', 'contract_financial_status',
    'totalUnits', (SELECT count(*)::int FROM u),
    'excludedUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason IS NOT NULL),
    'pseudoUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'pseudo_unit'),
    'offCensusUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'off_census'),
    'inactiveUnits', (SELECT count(*)::int FROM u WHERE exclusion_reason = 'inactive'),
    'censusUnits', (SELECT count(*)::int FROM ue),
    'occupiedUnits', (SELECT count(*)::int FROM occ),
    'vacantUnits', (SELECT count(*)::int FROM ue) - (SELECT count(*)::int FROM occ),
    'reservedUnits', (SELECT count(DISTINCT unit_source_id)::int FROM ko
                        WHERE occ_status = 'future' AND mi_date IS NOT NULL AND mi_date > today),
    'noticeCount', (SELECT count(DISTINCT unit_source_id)::int FROM ko WHERE occ_status = 'notice'),
    'byCareType', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'careType') FROM (
        SELECT jsonb_build_object(
                 'careType', ue.care_type,
                 'units', count(*)::int,
                 'occupied', count(*) FILTER (WHERE ue.source_id IN (SELECT unit_source_id FROM occ))::int) AS x
          FROM ue GROUP BY ue.care_type) q), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $function$;
