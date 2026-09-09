-- Residents-based occupancy: remove the per-room cap so each active contract counts
CREATE OR REPLACE FUNCTION public.wh_unit_census_rows(_org_id uuid, _scope uuid[])
 RETURNS TABLE(community_id uuid, source_id text, care_type text, exclusion_reason text, points integer, occupied_capacity integer, occupied_room integer, notice_capacity integer, notice_room integer, reserved_capacity integer, reserved_room integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH pats AS (
    SELECT COALESCE((SELECT x.pseudo_unit_patterns FROM public.wh_settings x
                      WHERE x.organization_id = _org_id), ARRAY['WAITLIST']::text[]) AS p
  ),
  u AS (
    SELECT un.community_id, un.source_id,
           COALESCE(NULLIF(btrim(un.care_type_label), ''), 'Unspecified') AS care_type,
           GREATEST(COALESCE(un.floor_plan_occupancy_points, 1)::int, 1) AS points,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           (SELECT p FROM pats)) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id AND un.community_id = ANY(_scope)
  ),
  k AS (
    SELECT hc.community_id, hc.unit_source_id,
           lower(COALESCE(hc.financial_status, hc.status, '')) AS occ_status,
           COALESCE(hc.financial_move_in_date, hc.move_in_date) AS mi_date
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(_scope)
       AND hc.discarded_at IS NULL
  ),
  agg AS (
    SELECT k.community_id, k.unit_source_id,
           count(*) FILTER (WHERE k.occ_status IN ('current','notice'))::int AS occ_n,
           count(*) FILTER (WHERE k.occ_status = 'notice')::int AS notice_n,
           count(*) FILTER (WHERE k.occ_status = 'future' AND k.mi_date IS NOT NULL
                              AND k.mi_date > current_date)::int AS reserved_n
      FROM k GROUP BY 1,2
  )
  SELECT u.community_id, u.source_id, u.care_type, u.exclusion_reason, u.points,
         CASE WHEN u.exclusion_reason IS NOT NULL THEN 0
              ELSE COALESCE(a.occ_n,0) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.occ_n,0) > 0 THEN 1 ELSE 0 END,
         CASE WHEN u.exclusion_reason IS NOT NULL THEN 0
              ELSE COALESCE(a.notice_n,0) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.notice_n,0) > 0 THEN 1 ELSE 0 END,
         CASE WHEN u.exclusion_reason IS NOT NULL THEN 0
              ELSE COALESCE(a.reserved_n,0) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.reserved_n,0) > 0 THEN 1 ELSE 0 END
    FROM u LEFT JOIN agg a
      ON a.community_id = u.community_id AND a.unit_source_id = u.source_id;
$function$;

-- Canonical occupied = residents for every capacity basis; capacity still excludes off-census units
CREATE OR REPLACE FUNCTION public.wh_community_capacity(_org_id uuid, _scope uuid[])
 RETURNS TABLE(community_id uuid, name text, capacity_basis text, total_unit_records integer, excluded_units integer, off_census_units integer, pseudo_units integer, inactive_units integer, census_rooms integer, census_capacity integer, configured_capacity integer, canonical_census integer, occupied_rooms integer, occupied_capacity integer, canonical_occupied integer, notice_rooms integer, notice_capacity integer, reserved_rooms integer, reserved_capacity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH r AS (SELECT * FROM public.wh_unit_census_rows(_org_id, _scope)),
  agg AS (
    SELECT c.id AS community_id, c.name, c.occupancy_capacity_basis AS basis,
           c.unit_count AS configured_capacity,
           COALESCE(count(r.source_id), 0)::int AS total_unit_records,
           COALESCE(count(*) FILTER (WHERE r.exclusion_reason IS NOT NULL), 0)::int AS excluded_units,
           COALESCE(count(*) FILTER (WHERE r.exclusion_reason = 'off_census'), 0)::int AS off_census_units,
           COALESCE(count(*) FILTER (WHERE r.exclusion_reason = 'pseudo_unit'), 0)::int AS pseudo_units,
           COALESCE(count(*) FILTER (WHERE r.exclusion_reason = 'inactive'), 0)::int AS inactive_units,
           COALESCE(count(*) FILTER (WHERE r.exclusion_reason IS NULL), 0)::int AS census_rooms,
           COALESCE(sum(r.points) FILTER (WHERE r.exclusion_reason IS NULL), 0)::int AS census_capacity,
           COALESCE(sum(r.occupied_room), 0)::int AS occupied_rooms,
           COALESCE(sum(r.occupied_capacity), 0)::int AS occupied_capacity,
           COALESCE(sum(r.notice_room), 0)::int AS notice_rooms,
           COALESCE(sum(r.notice_capacity), 0)::int AS notice_capacity,
           COALESCE(sum(r.reserved_room), 0)::int AS reserved_rooms,
           COALESCE(sum(r.reserved_capacity), 0)::int AS reserved_capacity
      FROM public.communities c
      LEFT JOIN r ON r.community_id = c.id
     WHERE c.id = ANY(_scope)
     GROUP BY c.id, c.name, c.occupancy_capacity_basis, c.unit_count
  )
  SELECT a.community_id, a.name, a.basis,
         a.total_unit_records, a.excluded_units, a.off_census_units,
         a.pseudo_units, a.inactive_units,
         a.census_rooms, a.census_capacity, a.configured_capacity,
         CASE a.basis
           WHEN 'occupancy_points' THEN a.census_capacity
           WHEN 'configured_capacity' THEN COALESCE(a.configured_capacity, a.census_capacity)
           ELSE a.census_rooms END,
         a.occupied_rooms, a.occupied_capacity,
         a.occupied_capacity,
         a.notice_rooms, a.notice_capacity, a.reserved_rooms, a.reserved_capacity
    FROM agg a;
$function$;

-- Current occupancy: notice/reserved/care-type breakdowns follow residents
CREATE OR REPLACE FUNCTION public.wh_current_occupancy(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; today date := current_date; res jsonb;
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

  WITH cap AS (SELECT * FROM public.wh_community_capacity(_org_id, scope)),
  r AS (SELECT * FROM public.wh_unit_census_rows(_org_id, scope)),
  pending AS (
    SELECT hc.community_id, count(*)::int AS n
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.discarded_at IS NULL
       AND lower(COALESCE(hc.financial_status, hc.status, '')) = 'future'
       AND COALESCE(hc.financial_move_in_date, hc.move_in_date) > today
     GROUP BY 1
  ),
  per AS (
    SELECT c.community_id AS id, c.name, c.capacity_basis,
           c.configured_capacity AS configured_units,
           c.total_unit_records, c.excluded_units, c.off_census_units,
           c.pseudo_units, c.inactive_units,
           c.census_rooms, c.census_capacity, c.configured_capacity,
           c.occupied_rooms, c.occupied_capacity,
           c.canonical_census AS census_units,
           c.canonical_occupied AS occupied_units,
           c.notice_capacity AS notice_units,
           c.reserved_capacity AS reserved_units,
           COALESCE((SELECT n FROM pending p WHERE p.community_id = c.community_id), 0) AS pending_move_ins,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'careType', q.care_type, 'units', q.units, 'occupied', q.occupied,
                       'rooms', q.rooms, 'capacity', q.capacity) ORDER BY q.care_type)
                     FROM (SELECT r.care_type,
                                  SUM(CASE WHEN c.capacity_basis = 'rooms' THEN 1 ELSE r.points END)::int AS units,
                                  SUM(r.occupied_capacity)::int AS occupied,
                                  count(*)::int AS rooms, SUM(r.points)::int AS capacity
                             FROM r WHERE r.community_id = c.community_id AND r.exclusion_reason IS NULL
                            GROUP BY r.care_type) q), '[]'::jsonb) AS by_care_type
      FROM cap c
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
        'censusRooms', COALESCE(sum(census_rooms), 0)::int,
        'censusCapacity', COALESCE(sum(census_capacity), 0)::int,
        'occupiedRooms', COALESCE(sum(occupied_rooms), 0)::int,
        'occupiedCapacity', COALESCE(sum(occupied_capacity), 0)::int,
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

-- Flash occupancy: same residents-based rule
CREATE OR REPLACE FUNCTION public.wh_flash_occupancy(_org_id uuid, _scope uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE today date := current_date; res jsonb;
BEGIN
  WITH cap AS (SELECT * FROM public.wh_community_capacity(_org_id, _scope)),
  r AS (SELECT * FROM public.wh_unit_census_rows(_org_id, _scope)),
  ctq AS (
    SELECT r.care_type,
           SUM(CASE WHEN c.capacity_basis = 'rooms' THEN 1 ELSE r.points END)::int AS units,
           SUM(r.occupied_capacity)::int AS occupied,
           SUM(1)::int AS rooms,
           SUM(r.points)::int AS capacity,
           SUM(r.occupied_room)::int AS occupied_rooms,
           SUM(r.occupied_capacity)::int AS occupied_capacity
      FROM r JOIN cap c ON c.community_id = r.community_id
     WHERE r.exclusion_reason IS NULL
     GROUP BY r.care_type
  )
  SELECT jsonb_build_object(
    'asOf', today,
    'basis', 'contract_financial_status',
    'capacityBasis', CASE WHEN (SELECT count(DISTINCT capacity_basis) FROM cap) = 1
                          THEN (SELECT min(capacity_basis) FROM cap) ELSE 'mixed' END,
    'totalUnits', (SELECT COALESCE(sum(total_unit_records),0)::int FROM cap),
    'excludedUnits', (SELECT COALESCE(sum(excluded_units),0)::int FROM cap),
    'pseudoUnits', (SELECT COALESCE(sum(pseudo_units),0)::int FROM cap),
    'offCensusUnits', (SELECT COALESCE(sum(off_census_units),0)::int FROM cap),
    'inactiveUnits', (SELECT COALESCE(sum(inactive_units),0)::int FROM cap),
    'censusRooms', (SELECT COALESCE(sum(census_rooms),0)::int FROM cap),
    'censusCapacity', (SELECT COALESCE(sum(census_capacity),0)::int FROM cap),
    'configuredCapacity', (SELECT sum(configured_capacity)::int FROM cap),
    'occupiedRooms', (SELECT COALESCE(sum(occupied_rooms),0)::int FROM cap),
    'occupiedCapacity', (SELECT COALESCE(sum(occupied_capacity),0)::int FROM cap),
    'censusUnits', (SELECT COALESCE(sum(canonical_census),0)::int FROM cap),
    'occupiedUnits', (SELECT COALESCE(sum(canonical_occupied),0)::int FROM cap),
    'vacantUnits', (SELECT COALESCE(sum(canonical_census) - sum(canonical_occupied),0)::int FROM cap),
    'reservedUnits', (SELECT COALESCE(sum(reserved_capacity),0)::int FROM cap),
    'noticeCount', (SELECT COALESCE(sum(notice_capacity),0)::int FROM cap),
    'byCareType', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'careType', care_type, 'units', units, 'occupied', occupied,
          'rooms', rooms, 'capacity', capacity,
          'occupiedRooms', occupied_rooms, 'occupiedCapacity', occupied_capacity)
          ORDER BY care_type) FROM ctq), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $function$;