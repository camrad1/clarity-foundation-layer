ALTER TABLE public.communities ADD COLUMN IF NOT EXISTS street_address text;

CREATE OR REPLACE FUNCTION public.wh_current_occupancy(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  pseudo_patterns text[];
  today date := current_date;
  res jsonb;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY['WAITLIST']::text[]) INTO pseudo_patterns
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  pseudo_patterns := COALESCE(pseudo_patterns, ARRAY['WAITLIST']::text[]);

  WITH u AS (
    SELECT un.community_id, un.source_id,
           COALESCE(NULLIF(btrim(un.care_type_label), ''), 'Unspecified') AS care_type,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           pseudo_patterns) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id AND un.community_id = ANY(scope)
  ),
  ue AS (SELECT * FROM u WHERE exclusion_reason IS NULL),
  k AS (
    SELECT hc.community_id, hc.unit_source_id,
           lower(COALESCE(hc.financial_status, hc.status, '')) AS occ_status,
           COALESCE(hc.financial_move_in_date, hc.move_in_date) AS mi_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.discarded_at IS NULL
  ),
  ko AS (
    SELECT k.* FROM k
     JOIN ue ON ue.community_id = k.community_id AND ue.source_id = k.unit_source_id
  ),
  occ AS (
    SELECT DISTINCT community_id, unit_source_id FROM ko WHERE occ_status IN ('current', 'notice')
  ),
  notice AS (
    SELECT DISTINCT community_id, unit_source_id FROM ko WHERE occ_status = 'notice'
  ),
  reserved AS (
    SELECT DISTINCT community_id, unit_source_id FROM ko
     WHERE occ_status = 'future' AND mi_date IS NOT NULL AND mi_date > today
  ),
  pending AS (
    SELECT community_id, count(*)::int AS n FROM k
     WHERE occ_status = 'future' AND mi_date IS NOT NULL AND mi_date > today
     GROUP BY 1
  ),
  per AS (
    SELECT c.id, c.name, c.unit_count AS configured_units,
           (SELECT count(*)::int FROM u WHERE u.community_id = c.id) AS total_unit_records,
           (SELECT count(*)::int FROM u WHERE u.community_id = c.id AND exclusion_reason IS NOT NULL) AS excluded_units,
           (SELECT count(*)::int FROM u WHERE u.community_id = c.id AND exclusion_reason = 'off_census') AS off_census_units,
           (SELECT count(*)::int FROM u WHERE u.community_id = c.id AND exclusion_reason = 'pseudo_unit') AS pseudo_units,
           (SELECT count(*)::int FROM u WHERE u.community_id = c.id AND exclusion_reason = 'inactive') AS inactive_units,
           (SELECT count(*)::int FROM ue WHERE ue.community_id = c.id) AS census_units,
           (SELECT count(*)::int FROM occ WHERE occ.community_id = c.id) AS occupied_units,
           (SELECT count(*)::int FROM notice WHERE notice.community_id = c.id) AS notice_units,
           (SELECT count(*)::int FROM reserved WHERE reserved.community_id = c.id) AS reserved_units,
           COALESCE((SELECT n FROM pending WHERE pending.community_id = c.id), 0) AS pending_move_ins,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'careType', q.care_type, 'units', q.units, 'occupied', q.occupied) ORDER BY q.care_type)
                       FROM (SELECT ue.care_type, count(*)::int AS units,
                                    count(*) FILTER (WHERE EXISTS (
                                       SELECT 1 FROM occ WHERE occ.community_id = ue.community_id
                                        AND occ.unit_source_id = ue.source_id))::int AS occupied
                               FROM ue WHERE ue.community_id = c.id GROUP BY ue.care_type) q), '[]'::jsonb) AS by_care_type
      FROM public.communities c
     WHERE c.id = ANY(scope)
  ),
  per2 AS (
    SELECT per.*,
           CASE WHEN census_units = 0 THEN NULL
                ELSE round(occupied_units::numeric / census_units::numeric, 6) END AS occupancy_pct,
           (census_units - occupied_units) AS vacant_units,
           (configured_units IS NOT NULL AND census_units > 0 AND configured_units <> census_units) AS unit_count_discrepancy
      FROM per
  )
  SELECT jsonb_build_object(
    'asOf', today,
    'basis', 'contract_financial_status',
    'communities', COALESCE((SELECT jsonb_agg(to_jsonb(per2) ORDER BY per2.name) FROM per2), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
        'totalUnitRecords', COALESCE(sum(total_unit_records), 0)::int,
        'excludedUnits', COALESCE(sum(excluded_units), 0)::int,
        'offCensusUnits', COALESCE(sum(off_census_units), 0)::int,
        'pseudoUnits', COALESCE(sum(pseudo_units), 0)::int,
        'inactiveUnits', COALESCE(sum(inactive_units), 0)::int,
        'censusUnits', COALESCE(sum(census_units), 0)::int,
        'occupiedUnits', COALESCE(sum(occupied_units), 0)::int,
        'vacantUnits', COALESCE(sum(vacant_units), 0)::int,
        'noticeUnits', COALESCE(sum(notice_units), 0)::int,
        'reservedUnits', COALESCE(sum(reserved_units), 0)::int,
        'pendingMoveIns', COALESCE(sum(pending_move_ins), 0)::int,
        'configuredUnits', sum(configured_units)::int,
        'occupancyPct', CASE WHEN COALESCE(sum(census_units), 0) = 0 THEN NULL
             ELSE round(sum(occupied_units)::numeric / sum(census_units)::numeric, 6) END
      ) FROM per2)
  ) INTO res;

  RETURN res;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_current_occupancy(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_current_occupancy(uuid, uuid[]) TO authenticated;
