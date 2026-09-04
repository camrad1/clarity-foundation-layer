-- 1. Community-level canonical capacity basis
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS occupancy_capacity_basis text NOT NULL DEFAULT 'rooms';

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_occupancy_capacity_basis_check;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_occupancy_capacity_basis_check
  CHECK (occupancy_capacity_basis IN ('rooms','occupancy_points','configured_capacity'));

UPDATE public.communities
   SET occupancy_capacity_basis = 'occupancy_points', updated_at = now()
 WHERE name ILIKE 'Sonnet Hill%';

-- 2. Canonical per-unit census rows (single source of truth)
CREATE OR REPLACE FUNCTION public.wh_unit_census_rows(_org_id uuid, _scope uuid[])
RETURNS TABLE(
  community_id uuid, source_id text, care_type text, exclusion_reason text,
  points int, occupied_capacity int, occupied_room int,
  notice_capacity int, notice_room int, reserved_capacity int, reserved_room int
)
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
              ELSE LEAST(COALESCE(a.occ_n,0), u.points) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.occ_n,0) > 0 THEN 1 ELSE 0 END,
         CASE WHEN u.exclusion_reason IS NOT NULL THEN 0
              ELSE LEAST(COALESCE(a.notice_n,0), u.points) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.notice_n,0) > 0 THEN 1 ELSE 0 END,
         CASE WHEN u.exclusion_reason IS NOT NULL THEN 0
              ELSE LEAST(COALESCE(a.reserved_n,0), u.points) END,
         CASE WHEN u.exclusion_reason IS NULL AND COALESCE(a.reserved_n,0) > 0 THEN 1 ELSE 0 END
    FROM u LEFT JOIN agg a
      ON a.community_id = u.community_id AND a.unit_source_id = u.source_id;
$function$;

-- 3. Canonical per-community capacity layer
CREATE OR REPLACE FUNCTION public.wh_community_capacity(_org_id uuid, _scope uuid[])
RETURNS TABLE(
  community_id uuid, name text, capacity_basis text,
  total_unit_records int, excluded_units int, off_census_units int,
  pseudo_units int, inactive_units int,
  census_rooms int, census_capacity int, configured_capacity int,
  canonical_census int, occupied_rooms int, occupied_capacity int,
  canonical_occupied int, notice_rooms int, notice_capacity int,
  reserved_rooms int, reserved_capacity int
)
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
         CASE a.basis WHEN 'rooms' THEN a.occupied_rooms ELSE a.occupied_capacity END,
         a.notice_rooms, a.notice_capacity, a.reserved_rooms, a.reserved_capacity
    FROM agg a;
$function$;

GRANT EXECUTE ON FUNCTION public.wh_unit_census_rows(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wh_community_capacity(uuid, uuid[]) TO authenticated, service_role;

-- 4. Flash occupancy now reads the canonical layer (keys unchanged; extras added)
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
           SUM(CASE WHEN c.capacity_basis = 'rooms' THEN r.occupied_room ELSE r.occupied_capacity END)::int AS occupied,
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
    'reservedUnits', (SELECT COALESCE(sum(CASE WHEN capacity_basis = 'rooms' THEN reserved_rooms ELSE reserved_capacity END),0)::int FROM cap),
    'noticeCount', (SELECT COALESCE(sum(CASE WHEN capacity_basis = 'rooms' THEN notice_rooms ELSE notice_capacity END),0)::int FROM cap),
    'byCareType', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'careType', care_type, 'units', units, 'occupied', occupied,
          'rooms', rooms, 'capacity', capacity,
          'occupiedRooms', occupied_rooms, 'occupiedCapacity', occupied_capacity)
          ORDER BY care_type) FROM ctq), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $function$;

-- 5. Current occupancy report reads the canonical layer
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
           CASE WHEN c.capacity_basis = 'rooms' THEN c.notice_rooms ELSE c.notice_capacity END AS notice_units,
           CASE WHEN c.capacity_basis = 'rooms' THEN c.reserved_rooms ELSE c.reserved_capacity END AS reserved_units,
           COALESCE((SELECT n FROM pending p WHERE p.community_id = c.community_id), 0) AS pending_move_ins,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'careType', q.care_type, 'units', q.units, 'occupied', q.occupied,
                       'rooms', q.rooms, 'capacity', q.capacity) ORDER BY q.care_type)
                     FROM (SELECT r.care_type,
                                  SUM(CASE WHEN c.capacity_basis = 'rooms' THEN 1 ELSE r.points END)::int AS units,
                                  SUM(CASE WHEN c.capacity_basis = 'rooms' THEN r.occupied_room ELSE r.occupied_capacity END)::int AS occupied,
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

-- 6. Snapshot metadata
ALTER TABLE public.community_daily_snapshots
  ADD COLUMN IF NOT EXISTS capacity_basis text,
  ADD COLUMN IF NOT EXISTS census_rooms int,
  ADD COLUMN IF NOT EXISTS census_capacity int,
  ADD COLUMN IF NOT EXISTS occupied_rooms int,
  ADD COLUMN IF NOT EXISTS occupied_capacity int,
  ADD COLUMN IF NOT EXISTS canonical_for_trend boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS noncanonical_reason text;

CREATE OR REPLACE FUNCTION public.wh_write_daily_snapshot(_org_id uuid, _community_id uuid, _snapshot_date date DEFAULT NULL::date, _sync_run_id uuid DEFAULT NULL::uuid, _connection_id uuid DEFAULT NULL::uuid, _source_through timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tz text; cfg int; sdate date; occ jsonb; bud jsonb;
  b_units int; b_pct numeric; occ_pct numeric; snap_id uuid;
  p_in int; p_out int; ct jsonb; basis text;
BEGIN
  SELECT c.timezone, c.unit_count, c.occupancy_capacity_basis INTO tz, cfg, basis
    FROM public.communities c
   WHERE c.id = _community_id AND c.organization_id = _org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Community not found in organization'; END IF;

  sdate := COALESCE(_snapshot_date, (now() AT TIME ZONE COALESCE(tz, 'UTC'))::date);

  IF EXISTS (SELECT 1 FROM public.community_daily_snapshots s
              WHERE s.organization_id = _org_id AND s.community_id = _community_id
                AND s.snapshot_date = sdate AND s.status = 'success') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'exists', 'snapshotDate', sdate);
  END IF;

  occ := public.wh_flash_occupancy(_org_id, ARRAY[_community_id]);
  bud := public.flash_budget_units(_org_id, ARRAY[_community_id], sdate);
  b_units := NULLIF(bud->>'units','')::int;
  b_pct := NULLIF(bud->>'pct','')::numeric;

  occ_pct := CASE WHEN COALESCE((occ->>'censusUnits')::int, 0) = 0 THEN NULL
                  ELSE round((occ->>'occupiedUnits')::numeric / (occ->>'censusUnits')::numeric, 6) END;

  SELECT
    count(*) FILTER (WHERE hc.count_move_in IS TRUE
                       AND COALESCE(hc.financial_move_in_date, hc.move_in_date) > sdate)::int,
    count(*) FILTER (WHERE hc.count_move_out IS TRUE
                       AND COALESCE(hc.financial_move_out_date, hc.move_out_date) > sdate)::int
    INTO p_in, p_out
    FROM public.wh_housing_contracts hc
   WHERE hc.organization_id = _org_id AND hc.community_id = _community_id
     AND hc.lease_canceled_on IS NULL AND hc.discarded_at IS NULL;

  DELETE FROM public.community_daily_snapshots s
   WHERE s.organization_id = _org_id AND s.community_id = _community_id
     AND s.snapshot_date = sdate AND s.status = 'failed';

  INSERT INTO public.community_daily_snapshots (
    organization_id, community_id, snapshot_date, snapshot_at, local_timezone, status,
    source_connection_id, sync_run_id, metric_version, source_data_through_at,
    total_unit_records, configured_operational_units, census_units, occupied_units,
    vacant_units, occupancy_pct, notice_count, reserved_count, off_census_units,
    pseudo_units, inactive_units, pending_move_ins, pending_move_outs,
    budget_units, budget_pct, occupancy_variance_units, occupancy_variance_pct,
    capacity_basis, census_rooms, census_capacity, occupied_rooms, occupied_capacity
  ) VALUES (
    _org_id, _community_id, sdate, now(), tz, 'success',
    _connection_id, _sync_run_id, '2.0', _source_through,
    (occ->>'totalUnits')::int, cfg, (occ->>'censusUnits')::int, (occ->>'occupiedUnits')::int,
    (occ->>'vacantUnits')::int, occ_pct, (occ->>'noticeCount')::int, (occ->>'reservedUnits')::int,
    (occ->>'offCensusUnits')::int, (occ->>'pseudoUnits')::int, (occ->>'inactiveUnits')::int,
    p_in, p_out,
    b_units, b_pct,
    CASE WHEN b_units IS NULL THEN NULL ELSE (occ->>'occupiedUnits')::int - b_units END,
    CASE WHEN b_pct IS NULL OR occ_pct IS NULL THEN NULL
         ELSE round(occ_pct * 100 - b_pct, 2) END,
    basis, (occ->>'censusRooms')::int, (occ->>'censusCapacity')::int,
    (occ->>'occupiedRooms')::int, (occ->>'occupiedCapacity')::int
  ) RETURNING id INTO snap_id;

  FOR ct IN SELECT * FROM jsonb_array_elements(COALESCE(occ->'byCareType', '[]'::jsonb)) LOOP
    INSERT INTO public.community_daily_snapshot_care_types (
      snapshot_id, organization_id, community_id, snapshot_date,
      care_type_label, census_units, occupied_units, occupancy_pct)
    VALUES (
      snap_id, _org_id, _community_id, sdate,
      COALESCE(ct->>'careType','Unspecified'),
      COALESCE((ct->>'units')::int, 0),
      COALESCE((ct->>'occupied')::int, 0),
      CASE WHEN COALESCE((ct->>'units')::int,0) = 0 THEN NULL
           ELSE round((ct->>'occupied')::numeric / (ct->>'units')::numeric, 6) END);
  END LOOP;

  RETURN jsonb_build_object('created', true, 'snapshotId', snap_id, 'snapshotDate', sdate,
                            'capacityBasis', basis,
                            'censusUnits', (occ->>'censusUnits')::int,
                            'occupiedUnits', (occ->>'occupiedUnits')::int,
                            'occupancyPct', occ_pct);
END; $function$;

-- 7. Trend/history readers must ignore snapshots written under a superseded basis
CREATE OR REPLACE FUNCTION public.wh_occupancy_history_daily(_org_id uuid, _scope uuid[], _start date, _end date)
RETURNS TABLE(community_id uuid, d date, src text, census numeric, occupied numeric, beginning_occupied numeric, vacant numeric, notice numeric, reserved numeric, budget numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH snaps AS (
    SELECT sn.community_id, sn.snapshot_date AS d, 'snapshot'::text AS src,
           sn.census_units::numeric, sn.occupied_units::numeric,
           sn.occupied_units::numeric AS beginning_occupied,
           sn.vacant_units::numeric, sn.notice_count::numeric,
           sn.reserved_count::numeric, sn.budget_units::numeric
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id
       AND sn.community_id = ANY(_scope)
       AND COALESCE(sn.status,'success') = 'success'
       AND COALESCE(sn.canonical_for_trend, true)
       AND (_start IS NULL OR sn.snapshot_date >= _start)
       AND (_end IS NULL OR sn.snapshot_date <= _end)
  )
  SELECT * FROM snaps
  UNION ALL
  SELECT h.community_id, h.occupancy_date, 'official_backfill'::text,
         h.total_units, h.ending_occupied_units,
         COALESCE(h.beginning_occupied_units, h.ending_occupied_units),
         CASE WHEN h.total_units IS NOT NULL
              THEN h.total_units - h.ending_occupied_units END,
         NULL::numeric, NULL::numeric,
         (SELECT fb.budget_occupied_units::numeric
            FROM public.flash_occupancy_budgets fb
           WHERE fb.organization_id = _org_id AND fb.community_id = h.community_id
             AND fb.effective_start <= h.occupancy_date
             AND (fb.effective_end IS NULL OR fb.effective_end >= h.occupancy_date)
           ORDER BY fb.effective_start DESC LIMIT 1)
    FROM public.community_daily_occupancy_history h
   WHERE h.organization_id = _org_id
     AND h.community_id = ANY(_scope)
     AND h.source_type = 'official_daily_backfill'
     AND h.ending_occupied_units IS NOT NULL
     AND (_start IS NULL OR h.occupancy_date >= _start)
     AND (_end IS NULL OR h.occupancy_date <= _end)
     AND NOT EXISTS (SELECT 1 FROM snaps s
                      WHERE s.community_id = h.community_id AND s.d = h.occupancy_date);
$function$;

CREATE OR REPLACE FUNCTION public.wh_snapshot_asof(_org_id uuid, _scope uuid[], _date date, _tolerance integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF _scope IS NULL OR COALESCE(array_length(_scope,1),0) = 0 THEN RETURN NULL; END IF;

  WITH snap AS (
    SELECT DISTINCT ON (s.community_id) s.*
      FROM public.community_daily_snapshots s
     WHERE s.organization_id = _org_id
       AND s.community_id = ANY(_scope)
       AND s.status = 'success'
       AND COALESCE(s.canonical_for_trend, true)
       AND s.snapshot_date <= _date
       AND s.snapshot_date >= _date - GREATEST(_tolerance, 0)
     ORDER BY s.community_id, s.snapshot_date DESC
  ),
  back AS (
    SELECT DISTINCT ON (h.community_id) h.*
      FROM public.community_daily_occupancy_history h
     WHERE h.organization_id = _org_id
       AND h.community_id = ANY(_scope)
       AND h.source_type = 'official_daily_backfill'
       AND h.occupancy_date <= _date
       AND h.occupancy_date >= _date - GREATEST(_tolerance, 0)
       AND NOT EXISTS (SELECT 1 FROM snap sp WHERE sp.community_id = h.community_id)
     ORDER BY h.community_id, h.occupancy_date DESC
  ),
  latest AS (
    SELECT s.id, s.community_id, s.snapshot_date AS as_of_date, 'snapshot'::text AS src,
           s.total_unit_records::numeric AS total_unit_records, s.census_units::numeric AS census_units,
           s.occupied_units::numeric AS occupied_units, s.vacant_units::numeric AS vacant_units,
           s.notice_count::numeric AS notice_count, s.reserved_count::numeric AS reserved_count,
           s.off_census_units::numeric AS off_census_units, s.pseudo_units::numeric AS pseudo_units,
           s.inactive_units::numeric AS inactive_units, s.budget_units::numeric AS budget_units
      FROM snap s
    UNION ALL
    SELECT NULL::uuid, b.community_id, b.occupancy_date, 'official_backfill'::text,
           b.total_units, b.total_units, b.ending_occupied_units,
           CASE WHEN b.total_units IS NOT NULL THEN b.total_units - b.ending_occupied_units END,
           NULL, NULL, NULL, NULL, NULL,
           (SELECT fb.budget_occupied_units::numeric
              FROM public.flash_occupancy_budgets fb
             WHERE fb.organization_id = _org_id AND fb.community_id = b.community_id
               AND fb.effective_start <= b.occupancy_date
               AND (fb.effective_end IS NULL OR fb.effective_end >= b.occupancy_date)
             ORDER BY fb.effective_start DESC LIMIT 1)
      FROM back b
  ),
  ct AS (
    SELECT t.care_type_label,
           SUM(t.census_units)::int AS units,
           SUM(t.occupied_units)::int AS occupied
      FROM public.community_daily_snapshot_care_types t
      JOIN latest l ON l.id = t.snapshot_id
     GROUP BY t.care_type_label
  )
  SELECT CASE WHEN (SELECT count(*) FROM latest) = 0 THEN NULL ELSE jsonb_build_object(
    'source', CASE
      WHEN (SELECT count(*) FROM latest WHERE src = 'official_backfill') = 0 THEN 'snapshot'
      WHEN (SELECT count(*) FROM latest WHERE src = 'snapshot') = 0 THEN 'official_backfill'
      ELSE 'mixed' END,
    'snapshotCommunities', (SELECT count(*)::int FROM latest WHERE src = 'snapshot'),
    'backfillCommunities', (SELECT count(*)::int FROM latest WHERE src = 'official_backfill'),
    'asOf', _date,
    'snapshotDate', (SELECT max(as_of_date) FROM latest),
    'oldestSnapshotDate', (SELECT min(as_of_date) FROM latest),
    'communitiesCovered', (SELECT count(*)::int FROM latest),
    'communitiesRequested', COALESCE(array_length(_scope,1), 0),
    'complete', (SELECT count(*) FROM latest) = COALESCE(array_length(_scope,1), 0),
    'totalUnits', (SELECT COALESCE(sum(total_unit_records),0)::int FROM latest),
    'censusUnits', (SELECT COALESCE(sum(census_units),0)::int FROM latest),
    'occupiedUnits', (SELECT round(COALESCE(sum(occupied_units),0))::int FROM latest),
    'vacantUnits', (SELECT round(COALESCE(sum(vacant_units),0))::int FROM latest),
    'noticeCount', (SELECT COALESCE(sum(notice_count),0)::int FROM latest),
    'reservedUnits', (SELECT COALESCE(sum(reserved_count),0)::int FROM latest),
    'offCensusUnits', (SELECT COALESCE(sum(off_census_units),0)::int FROM latest),
    'pseudoUnits', (SELECT COALESCE(sum(pseudo_units),0)::int FROM latest),
    'inactiveUnits', (SELECT COALESCE(sum(inactive_units),0)::int FROM latest),
    'excludedUnits', (SELECT COALESCE(sum(COALESCE(off_census_units,0) + COALESCE(pseudo_units,0) + COALESCE(inactive_units,0)),0)::int FROM latest),
    'budgetUnits', (SELECT NULLIF(round(COALESCE(sum(budget_units),0)),0)::int FROM latest),
    'occupancyPct', (SELECT CASE WHEN COALESCE(sum(census_units),0) = 0 THEN NULL
                          ELSE round(sum(occupied_units)::numeric / sum(census_units)::numeric, 6) END FROM latest),
    'byCareType', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'careType', care_type_label, 'units', units, 'occupied', occupied) ORDER BY care_type_label) FROM ct), '[]'::jsonb)
  ) END INTO res;

  RETURN res;
END; $function$;

-- 8. Mark existing room-basis Sonnet Hill snapshots as noncanonical for trends (audit-preserving)
DO $do$
BEGIN
  PERFORM set_config('clarity.snapshot_repair', 'on', true);
  UPDATE public.community_daily_snapshots s
     SET canonical_for_trend = false,
         noncanonical_reason = 'written under rooms capacity basis; superseded by occupancy_points basis'
    FROM public.communities c
   WHERE c.id = s.community_id
     AND c.name ILIKE 'Sonnet Hill%'
     AND s.capacity_basis IS NULL;
  PERFORM set_config('clarity.snapshot_repair', 'off', true);
END
$do$;