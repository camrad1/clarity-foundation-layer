-- ============================================================
-- IMMUTABLE DAILY SNAPSHOTS
-- ============================================================

DROP TABLE IF EXISTS public.community_daily_snapshots CASCADE;

CREATE TABLE public.community_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  local_timezone text,
  status text NOT NULL DEFAULT 'success',
  failure_reason text,
  source_connection_id uuid REFERENCES public.data_source_connections(id) ON DELETE SET NULL,
  sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE SET NULL,
  metric_version text NOT NULL DEFAULT '1.0',
  source_data_through_at timestamptz,

  total_unit_records int,
  configured_operational_units int,
  census_units int,
  occupied_units int,
  vacant_units int,
  occupancy_pct numeric,
  residents_count int,
  notice_count int,
  reserved_count int,
  off_census_units int,
  pseudo_units int,
  inactive_units int,
  pending_move_ins int,
  pending_move_outs int,

  -- Pipeline metrics are intentionally nullable and are NOT written yet:
  -- they are not reconciled, and a snapshot must never carry provisional
  -- numbers that later read as historical fact.
  open_pipeline int,
  hot_leads int,
  hot_no_future_activity int,
  stalled_prospects int,

  budget_units int,
  budget_pct numeric,
  occupancy_variance_units int,
  occupancy_variance_pct numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_daily_snapshots_status_ck CHECK (status IN ('success','failed'))
);

-- One successful snapshot per organization + community + local snapshot date.
CREATE UNIQUE INDEX community_daily_snapshots_success_uq
  ON public.community_daily_snapshots (organization_id, community_id, snapshot_date)
  WHERE status = 'success';
CREATE UNIQUE INDEX community_daily_snapshots_failed_uq
  ON public.community_daily_snapshots (organization_id, community_id, snapshot_date)
  WHERE status = 'failed';
CREATE INDEX community_daily_snapshots_range_idx
  ON public.community_daily_snapshots (organization_id, community_id, snapshot_date DESC)
  WHERE status = 'success';
CREATE INDEX community_daily_snapshots_org_date_idx
  ON public.community_daily_snapshots (organization_id, snapshot_date DESC);

CREATE TABLE public.community_daily_snapshot_care_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.community_daily_snapshots(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  care_type_label text NOT NULL,
  census_units int NOT NULL DEFAULT 0,
  occupied_units int NOT NULL DEFAULT 0,
  occupancy_pct numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, care_type_label)
);
CREATE INDEX community_daily_snapshot_care_types_idx
  ON public.community_daily_snapshot_care_types (organization_id, community_id, snapshot_date DESC);

GRANT SELECT ON public.community_daily_snapshots TO authenticated;
GRANT ALL ON public.community_daily_snapshots TO service_role;
GRANT SELECT ON public.community_daily_snapshot_care_types TO authenticated;
GRANT ALL ON public.community_daily_snapshot_care_types TO service_role;

ALTER TABLE public.community_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_daily_snapshot_care_types ENABLE ROW LEVEL SECURITY;

-- Read-only for authorized users. There is deliberately NO insert/update/delete
-- policy: snapshot history can only be written by the nightly service role.
CREATE POLICY "Read snapshots for authorized communities"
  ON public.community_daily_snapshots FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));

CREATE POLICY "Read snapshot care types for authorized communities"
  ON public.community_daily_snapshot_care_types FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id) AND public.has_community_access(community_id));

-- ------------------------------------------------------------
-- IMMUTABILITY
-- A successful snapshot is a historical fact. Updating or deleting one
-- requires an explicit, deliberate repair flag set by an audited backend
-- process; ordinary upsert logic can never rewrite history.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_snapshot_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'success'
     AND COALESCE(current_setting('clarity.snapshot_repair', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Daily snapshots are immutable (community %, date %)', OLD.community_id, OLD.snapshot_date;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'success'
     AND COALESCE(current_setting('clarity.snapshot_repair', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Daily snapshots are immutable (community %, date %)', OLD.community_id, OLD.snapshot_date;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER community_daily_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.community_daily_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_snapshot_immutability();

-- ============================================================
-- SNAPSHOT WRITER (service role only)
-- Reuses the canonical current-state occupancy calculation — snapshots never
-- introduce a second occupancy formula.
-- ============================================================
CREATE OR REPLACE FUNCTION public.wh_write_daily_snapshot(
  _org_id uuid,
  _community_id uuid,
  _snapshot_date date DEFAULT NULL,
  _sync_run_id uuid DEFAULT NULL,
  _connection_id uuid DEFAULT NULL,
  _source_through timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz text; cfg int; sdate date; occ jsonb; bud jsonb;
  b_units int; b_pct numeric; occ_pct numeric; snap_id uuid;
  p_in int; p_out int; ct jsonb;
BEGIN
  SELECT c.timezone, c.unit_count INTO tz, cfg
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

  -- A prior FAILED attempt for the same date is replaced; successes never are.
  DELETE FROM public.community_daily_snapshots s
   WHERE s.organization_id = _org_id AND s.community_id = _community_id
     AND s.snapshot_date = sdate AND s.status = 'failed';

  INSERT INTO public.community_daily_snapshots (
    organization_id, community_id, snapshot_date, snapshot_at, local_timezone, status,
    source_connection_id, sync_run_id, metric_version, source_data_through_at,
    total_unit_records, configured_operational_units, census_units, occupied_units,
    vacant_units, occupancy_pct, notice_count, reserved_count, off_census_units,
    pseudo_units, inactive_units, pending_move_ins, pending_move_outs,
    budget_units, budget_pct, occupancy_variance_units, occupancy_variance_pct
  ) VALUES (
    _org_id, _community_id, sdate, now(), tz, 'success',
    _connection_id, _sync_run_id, '1.0', _source_through,
    (occ->>'totalUnits')::int, cfg, (occ->>'censusUnits')::int, (occ->>'occupiedUnits')::int,
    (occ->>'vacantUnits')::int, occ_pct, (occ->>'noticeCount')::int, (occ->>'reservedUnits')::int,
    (occ->>'offCensusUnits')::int, (occ->>'pseudoUnits')::int, (occ->>'inactiveUnits')::int,
    p_in, p_out,
    b_units, b_pct,
    CASE WHEN b_units IS NULL THEN NULL ELSE (occ->>'occupiedUnits')::int - b_units END,
    CASE WHEN b_pct IS NULL OR occ_pct IS NULL THEN NULL
         ELSE round(occ_pct * 100 - b_pct, 2) END
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
                            'censusUnits', (occ->>'censusUnits')::int,
                            'occupiedUnits', (occ->>'occupiedUnits')::int,
                            'occupancyPct', occ_pct);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_record_snapshot_failure(
  _org_id uuid, _community_id uuid, _reason text,
  _snapshot_date date DEFAULT NULL, _sync_run_id uuid DEFAULT NULL, _connection_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text; sdate date;
BEGIN
  SELECT c.timezone INTO tz FROM public.communities c
   WHERE c.id = _community_id AND c.organization_id = _org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Community not found in organization'; END IF;
  sdate := COALESCE(_snapshot_date, (now() AT TIME ZONE COALESCE(tz,'UTC'))::date);

  IF EXISTS (SELECT 1 FROM public.community_daily_snapshots s
              WHERE s.organization_id = _org_id AND s.community_id = _community_id
                AND s.snapshot_date = sdate AND s.status = 'success') THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'success_exists');
  END IF;

  DELETE FROM public.community_daily_snapshots s
   WHERE s.organization_id = _org_id AND s.community_id = _community_id
     AND s.snapshot_date = sdate AND s.status = 'failed';

  INSERT INTO public.community_daily_snapshots
    (organization_id, community_id, snapshot_date, status, failure_reason,
     source_connection_id, sync_run_id, local_timezone)
  VALUES (_org_id, _community_id, sdate, 'failed', left(_reason, 500), _connection_id, _sync_run_id, tz);

  RETURN jsonb_build_object('recorded', true, 'snapshotDate', sdate);
END; $$;

REVOKE ALL ON FUNCTION public.wh_write_daily_snapshot(uuid, uuid, date, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_record_snapshot_failure(uuid, uuid, text, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wh_write_daily_snapshot(uuid, uuid, date, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.wh_record_snapshot_failure(uuid, uuid, text, date, uuid, uuid) TO service_role;

-- ============================================================
-- READ PATHS
-- ============================================================

-- Aggregated occupancy AS OF a date, built ONLY from stored snapshots.
-- Never falls back to current state. Tolerance is in days (0 = exact date).
CREATE OR REPLACE FUNCTION public.wh_snapshot_asof(
  _org_id uuid, _scope uuid[], _date date, _tolerance int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  IF _scope IS NULL OR COALESCE(array_length(_scope,1),0) = 0 THEN RETURN NULL; END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.community_id) s.*
      FROM public.community_daily_snapshots s
     WHERE s.organization_id = _org_id
       AND s.community_id = ANY(_scope)
       AND s.status = 'success'
       AND s.snapshot_date <= _date
       AND s.snapshot_date >= _date - GREATEST(_tolerance, 0)
     ORDER BY s.community_id, s.snapshot_date DESC
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
    'source', 'snapshot',
    'asOf', _date,
    'snapshotDate', (SELECT max(snapshot_date) FROM latest),
    'oldestSnapshotDate', (SELECT min(snapshot_date) FROM latest),
    'communitiesCovered', (SELECT count(*)::int FROM latest),
    'communitiesRequested', COALESCE(array_length(_scope,1), 0),
    'complete', (SELECT count(*) FROM latest) = COALESCE(array_length(_scope,1), 0),
    'totalUnits', (SELECT COALESCE(sum(total_unit_records),0)::int FROM latest),
    'censusUnits', (SELECT COALESCE(sum(census_units),0)::int FROM latest),
    'occupiedUnits', (SELECT COALESCE(sum(occupied_units),0)::int FROM latest),
    'vacantUnits', (SELECT COALESCE(sum(vacant_units),0)::int FROM latest),
    'noticeCount', (SELECT COALESCE(sum(notice_count),0)::int FROM latest),
    'reservedUnits', (SELECT COALESCE(sum(reserved_count),0)::int FROM latest),
    'offCensusUnits', (SELECT COALESCE(sum(off_census_units),0)::int FROM latest),
    'pseudoUnits', (SELECT COALESCE(sum(pseudo_units),0)::int FROM latest),
    'inactiveUnits', (SELECT COALESCE(sum(inactive_units),0)::int FROM latest),
    'excludedUnits', (SELECT COALESCE(sum(off_census_units + pseudo_units + inactive_units),0)::int FROM latest),
    'budgetUnits', (SELECT NULLIF(COALESCE(sum(budget_units),0),0)::int FROM latest),
    'occupancyPct', (SELECT CASE WHEN COALESCE(sum(census_units),0) = 0 THEN NULL
                          ELSE round(sum(occupied_units)::numeric / sum(census_units)::numeric, 6) END FROM latest),
    'byCareType', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'careType', care_type_label, 'units', units, 'occupied', occupied) ORDER BY care_type_label) FROM ct), '[]'::jsonb)
  ) END INTO res;

  RETURN res;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_occupancy_asof(
  _org_id uuid, _community_ids uuid[] DEFAULT NULL, _date date DEFAULT NULL, _tolerance int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN public.wh_snapshot_asof(_org_id, scope, COALESCE(_date, current_date), _tolerance);
END; $$;

-- Historical occupancy trend. Weekly/monthly grains use the LAST snapshot in
-- each period (a period-end position), never an average of percentages.
CREATE OR REPLACE FUNCTION public.wh_occupancy_trend(
  _org_id uuid,
  _community_ids uuid[] DEFAULT NULL,
  _start date DEFAULT NULL,
  _end date DEFAULT NULL,
  _grain text DEFAULT 'daily'
) RETURNS TABLE (
  period_start date,
  snapshot_date date,
  communities int,
  census_units int,
  occupied_units int,
  vacant_units int,
  notice_count int,
  reserved_count int,
  occupancy_pct numeric,
  budget_units int,
  budget_pct numeric,
  variance_units int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; g text := lower(COALESCE(_grain, 'daily'));
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope,1),0) = 0 THEN RETURN; END IF;
  IF g NOT IN ('daily','weekly','monthly') THEN g := 'daily'; END IF;

  RETURN QUERY
  WITH s AS (
    SELECT sn.*,
           CASE g
             WHEN 'weekly' THEN public.flash_week_start(sn.snapshot_date)
             WHEN 'monthly' THEN date_trunc('month', sn.snapshot_date)::date
             ELSE sn.snapshot_date END AS pstart
      FROM public.community_daily_snapshots sn
     WHERE sn.organization_id = _org_id
       AND sn.community_id = ANY(scope)
       AND sn.status = 'success'
       AND (_start IS NULL OR sn.snapshot_date >= _start)
       AND (_end IS NULL OR sn.snapshot_date <= _end)
  ),
  -- Per community, the last snapshot inside each period.
  last_per_community AS (
    SELECT DISTINCT ON (s.pstart, s.community_id) s.*
      FROM s ORDER BY s.pstart, s.community_id, s.snapshot_date DESC
  )
  SELECT l.pstart,
         max(l.snapshot_date),
         count(*)::int,
         COALESCE(sum(l.census_units),0)::int,
         COALESCE(sum(l.occupied_units),0)::int,
         COALESCE(sum(l.vacant_units),0)::int,
         COALESCE(sum(l.notice_count),0)::int,
         COALESCE(sum(l.reserved_count),0)::int,
         CASE WHEN COALESCE(sum(l.census_units),0) = 0 THEN NULL
              ELSE round(sum(l.occupied_units)::numeric / sum(l.census_units)::numeric, 6) END,
         NULLIF(COALESCE(sum(l.budget_units),0),0)::int,
         CASE WHEN COALESCE(sum(l.census_units),0) = 0 OR COALESCE(sum(l.budget_units),0) = 0 THEN NULL
              ELSE round(sum(l.budget_units)::numeric * 100 / sum(l.census_units)::numeric, 2) END,
         CASE WHEN COALESCE(sum(l.budget_units),0) = 0 THEN NULL
              ELSE (sum(l.occupied_units) - sum(l.budget_units))::int END
    FROM last_per_community l
   GROUP BY l.pstart
   ORDER BY l.pstart;
END; $$;

-- Per-community nightly snapshot + sync health.
CREATE OR REPLACE FUNCTION public.wh_snapshot_health(
  _org_id uuid, _community_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  community_id uuid,
  community_name text,
  timezone text,
  expected_snapshot_date date,
  last_snapshot_date date,
  last_snapshot_at timestamptz,
  days_behind int,
  snapshot_missing boolean,
  last_failure_date date,
  last_failure_reason text,
  last_successful_sync_at timestamptz,
  last_sync_status text,
  source_stale boolean,
  first_snapshot_date date,
  snapshot_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  IF COALESCE(array_length(scope,1),0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id,
         c.name,
         c.timezone,
         (now() AT TIME ZONE COALESCE(c.timezone,'UTC'))::date AS expected_date,
         ok.last_date,
         ok.last_at,
         CASE WHEN ok.last_date IS NULL THEN NULL
              ELSE ((now() AT TIME ZONE COALESCE(c.timezone,'UTC'))::date - ok.last_date) END,
         (ok.last_date IS NULL
           OR ok.last_date < (now() AT TIME ZONE COALESCE(c.timezone,'UTC'))::date - 1),
         f.fail_date,
         f.reason,
         sy.last_ok,
         sy.last_status,
         (sy.last_ok IS NULL OR sy.last_ok < now() - interval '36 hours'),
         ok.first_date,
         COALESCE(ok.n, 0)
    FROM public.communities c
    LEFT JOIN LATERAL (
      SELECT max(s.snapshot_date) AS last_date, min(s.snapshot_date) AS first_date,
             max(s.snapshot_at) AS last_at, count(*)::int AS n
        FROM public.community_daily_snapshots s
       WHERE s.community_id = c.id AND s.status = 'success'
    ) ok ON true
    LEFT JOIN LATERAL (
      SELECT s.snapshot_date AS fail_date, s.failure_reason AS reason
        FROM public.community_daily_snapshots s
       WHERE s.community_id = c.id AND s.status = 'failed'
       ORDER BY s.snapshot_date DESC LIMIT 1
    ) f ON true
    LEFT JOIN LATERAL (
      SELECT max(r.completed_at) FILTER (WHERE r.status = 'success') AS last_ok,
             (SELECT r2.status::text FROM public.wh_sync_table_runs r2
               WHERE r2.community_id = c.id ORDER BY r2.created_at DESC LIMIT 1) AS last_status
        FROM public.wh_sync_table_runs r
       WHERE r.community_id = c.id
    ) sy ON true
   WHERE c.id = ANY(scope)
   ORDER BY c.name;
END; $$;

GRANT EXECUTE ON FUNCTION public.wh_occupancy_asof(uuid, uuid[], date, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wh_snapshot_health(uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.wh_occupancy_asof(uuid, uuid[], date, int) FROM anon;
REVOKE ALL ON FUNCTION public.wh_occupancy_trend(uuid, uuid[], date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.wh_snapshot_health(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.wh_snapshot_asof(uuid, uuid[], date, int) FROM PUBLIC, anon;

-- ============================================================
-- FLASH REPORT: historical current-state fields now come from snapshots.
-- Period-event metrics (MI/MO/inquiries/tours) are untouched.
-- ============================================================
CREATE OR REPLACE FUNCTION public.wh_flash_report(
  _org_id uuid, _start date, _end date, _month date, _community_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  scope uuid[];
  today date := current_date;
  m_start date := date_trunc('month', _month)::date;
  m_end date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  nm_start date := (date_trunc('month', _month) + interval '1 month')::date;
  nm_end date := (date_trunc('month', _month) + interval '2 month - 1 day')::date;
  ws date; we date; idx int := 0;
  weeks jsonb := '[]'::jsonb;
  occ jsonb; week_occ jsonb; row_json jsonb;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  occ := public.wh_flash_occupancy(_org_id, scope);

  ws := public.flash_week_start(m_start);
  LOOP
    we := ws + 6;
    EXIT WHEN we > m_end + 6;
    IF we >= m_start AND we <= m_end THEN
      idx := idx + 1;
      -- Historical weeks read the Saturday snapshot (tolerance: 1 day).
      -- The in-progress week keeps live current state.
      IF today BETWEEN ws AND we THEN
        week_occ := occ || jsonb_build_object('source', 'current');
      ELSE
        week_occ := public.wh_snapshot_asof(_org_id, scope, we, 1);
      END IF;
      row_json := public.wh_flash_period_metrics(_org_id, scope, ws, we)
        || jsonb_build_object(
             'label', 'WK ' || idx,
             'isCurrent', (today BETWEEN ws AND we),
             'budget', public.flash_budget_units(_org_id, scope, we),
             'occupancy', week_occ);
      weeks := weeks || jsonb_build_array(row_json);
    END IF;
    ws := ws + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'week', public.wh_flash_period_metrics(_org_id, scope, _start, _end)
              || jsonb_build_object('label', 'Selected Flash week',
                                    'isCurrent', (today BETWEEN _start AND _end),
                                    'budget', public.flash_budget_units(_org_id, scope, _end),
                                    'occupancy', CASE WHEN today BETWEEN _start AND _end
                                                      THEN occ || jsonb_build_object('source','current')
                                                      ELSE public.wh_snapshot_asof(_org_id, scope, _end, 1) END),
    'month', public.wh_flash_period_metrics(_org_id, scope, m_start, m_end)
              || jsonb_build_object('label', 'MONTH END',
                                    'budget', public.flash_budget_units(_org_id, scope, m_end),
                                    'occupancy', CASE WHEN today BETWEEN m_start AND m_end
                                                      THEN occ || jsonb_build_object('source','current')
                                                      ELSE public.wh_snapshot_asof(_org_id, scope, m_end, 1) END),
    'nextMonth', public.wh_flash_period_metrics(_org_id, scope, nm_start, nm_end)
              || jsonb_build_object('label', 'Next month'),
    -- Starting position going into the month: last snapshot before the first
    -- reporting week begins. Never reconstructed from current-state rows.
    'starting', jsonb_build_object(
        'label', 'Starting #',
        'asOfDate', public.flash_week_start(m_start) - 1,
        'occupancy', public.wh_snapshot_asof(_org_id, scope, public.flash_week_start(m_start) - 1, 7),
        'budget', public.flash_budget_units(_org_id, scope, public.flash_week_start(m_start) - 1)),
    'weeks', weeks,
    'occupancy', occ || jsonb_build_object('source','current'),
    'budget', public.flash_budget_units(_org_id, scope, today),
    'monthStart', m_start,
    'monthEnd', m_end,
    'communities', COALESCE(array_length(scope, 1), 0),
    'generatedAt', now()
  );
END; $$;
