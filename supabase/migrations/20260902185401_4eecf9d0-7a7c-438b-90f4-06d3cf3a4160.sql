ALTER TABLE public.wh_settings
  ADD COLUMN IF NOT EXISTS pseudo_unit_patterns text[] NOT NULL DEFAULT ARRAY['WAITLIST']::text[];

CREATE OR REPLACE FUNCTION public.wh_norm_unit_label(_v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(btrim(regexp_replace(COALESCE(_v, ''), '\s+', ' ', 'g'))), '')
$$;

-- Deterministic census-eligibility rule. Returns NULL when the unit is
-- census-eligible, otherwise the exclusion reason.
CREATE OR REPLACE FUNCTION public.wh_unit_census_exclusion(
  _unit_number text,
  _unit_name text,
  _floor_plan_label text,
  _off_census boolean,
  _discarded_at timestamptz,
  _status text,
  _pseudo_patterns text[]
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _off_census IS TRUE THEN 'off_census'
    WHEN _discarded_at IS NOT NULL THEN 'inactive'
    WHEN lower(COALESCE(_status, '')) IN ('inactive', 'discarded', 'archived') THEN 'inactive'
    WHEN EXISTS (
      SELECT 1
        FROM unnest(COALESCE(_pseudo_patterns, ARRAY['WAITLIST']::text[])) pat
       WHERE public.wh_norm_unit_label(pat) IS NOT NULL
         AND public.wh_norm_unit_label(pat) IN (
               public.wh_norm_unit_label(_unit_number),
               public.wh_norm_unit_label(_unit_name),
               public.wh_norm_unit_label(_floor_plan_label))
    ) THEN 'pseudo_unit'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.wh_unit_census_report(
  _org_id uuid,
  _community_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS TABLE (
  source_id text,
  unit_number text,
  unit_name text,
  floor_plan_label text,
  exclusion_reason text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  scope uuid[];
  pats text[];
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

  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY['WAITLIST']::text[]) INTO pats
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  pats := COALESCE(pats, ARRAY['WAITLIST']::text[]);

  RETURN QUERY
  SELECT un.source_id, un.unit_number, un.unit_name, un.floor_plan_label,
         public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                         un.off_census, un.discarded_at, un.status, pats)
    FROM public.wh_units un
   WHERE un.organization_id = _org_id
     AND un.community_id = ANY(scope)
     AND public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                         un.off_census, un.discarded_at, un.status, pats) IS NOT NULL
   ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.wh_unit_census_report(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_unit_census_report(uuid, uuid[]) TO authenticated, service_role;

-- Patch wh_sales_summary occupancy block in place.
DO $do$
DECLARE
  def text;
  newdef text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wh_sales_summary';

  newdef := replace(def, '  res jsonb;', '  res jsonb;' || E'\n' || '  pseudo_patterns text[];');
  IF newdef = def THEN RAISE EXCEPTION 'declare patch failed'; END IF;
  def := newdef;

  newdef := replace(def, '  ok_labels := public.wh_successful_result_labels(_org_id);',
    '  ok_labels := public.wh_successful_result_labels(_org_id);' || E'\n' ||
    '  SELECT COALESCE(x.pseudo_unit_patterns, ARRAY[''WAITLIST'']::text[]) INTO pseudo_patterns' || E'\n' ||
    '    FROM (SELECT 1) dd LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;' || E'\n' ||
    '  pseudo_patterns := COALESCE(pseudo_patterns, ARRAY[''WAITLIST'']::text[]);');
  IF newdef = def THEN RAISE EXCEPTION 'patterns patch failed'; END IF;
  def := newdef;

  newdef := replace(def,
'  u AS (
    SELECT un.off_census, un.source_id
      FROM public.wh_units un
     WHERE un.organization_id = _org_id
       AND un.community_id = ANY(scope)
  ),',
'  u AS (
    SELECT un.off_census, un.source_id,
           public.wh_unit_census_exclusion(un.unit_number, un.unit_name, un.floor_plan_label,
                                           un.off_census, un.discarded_at, un.status,
                                           pseudo_patterns) AS exclusion_reason
      FROM public.wh_units un
     WHERE un.organization_id = _org_id
       AND un.community_id = ANY(scope)
  ),');
  IF newdef = def THEN RAISE EXCEPTION 'u cte patch failed'; END IF;
  def := newdef;

  newdef := replace(def,
'      ''totalUnits'', (SELECT count(*)::int FROM u),
      ''offCensusUnits'', (SELECT count(*)::int FROM u WHERE off_census IS TRUE),
      ''censusUnits'', (SELECT count(*)::int FROM u WHERE off_census IS NOT TRUE),',
'      ''totalUnits'', (SELECT count(*)::int FROM u),
      ''offCensusUnits'', (SELECT count(*)::int FROM u WHERE exclusion_reason = ''off_census''),
      ''pseudoUnits'', (SELECT count(*)::int FROM u WHERE exclusion_reason = ''pseudo_unit''),
      ''inactiveUnits'', (SELECT count(*)::int FROM u WHERE exclusion_reason = ''inactive''),
      ''excludedUnits'', (SELECT count(*)::int FROM u WHERE exclusion_reason IS NOT NULL),
      ''censusUnits'', (SELECT count(*)::int FROM u WHERE exclusion_reason IS NULL),');
  IF newdef = def THEN RAISE EXCEPTION 'occupancy patch failed'; END IF;
  def := newdef;

  newdef := replace(def,
'      ''occupiedUnitsCandidate'', (SELECT count(DISTINCT unit_source_id)::int FROM k
          WHERE unit_source_id IS NOT NULL AND count_move_in IS TRUE',
'      ''occupiedUnitsCandidate'', (SELECT count(DISTINCT unit_source_id)::int FROM k
          WHERE unit_source_id IS NOT NULL
            AND unit_source_id IN (SELECT source_id FROM u WHERE exclusion_reason IS NULL)
            AND count_move_in IS TRUE');
  IF newdef = def THEN RAISE EXCEPTION 'occupied patch failed'; END IF;

  EXECUTE newdef;
END
$do$;

REVOKE ALL ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_sales_summary(uuid, date, date, uuid[]) TO authenticated, service_role;