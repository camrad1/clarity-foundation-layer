
CREATE OR REPLACE FUNCTION public.wh_lookup_coverage(
  _org_id uuid,
  _community_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(lookup_type text, referenced integer, resolved integer, unresolved integer, unresolved_ids text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scope uuid[];
BEGIN
  IF NOT public.has_org_access(_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized for organization %', _org_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND (_community_ids IS NULL OR c.id = ANY(_community_ids))
     AND public.has_community_access(c.id, auth.uid());

  IF scope IS NULL THEN
    scope := ARRAY[]::uuid[];
  END IF;

  RETURN QUERY
  WITH refs AS (
    SELECT 'lead_source'::text AS lt, x.id
      FROM (
        SELECT p.lead_source_id AS id FROM public.wh_prospects p
         WHERE p.organization_id = _org_id AND p.community_id = ANY(scope)
        UNION
        SELECT p.secondary_lead_source_id FROM public.wh_prospects p
         WHERE p.organization_id = _org_id AND p.community_id = ANY(scope)
        UNION
        SELECT m.lead_source_id FROM public.wh_marketing_touchpoints m
         WHERE m.organization_id = _org_id AND m.community_id = ANY(scope)
      ) x
    UNION ALL
    SELECT 'stage', x.id FROM (
        SELECT p.stage_id AS id FROM public.wh_prospects p
         WHERE p.organization_id = _org_id AND p.community_id = ANY(scope)
        UNION
        SELECT a.stage_id FROM public.wh_activities a
         WHERE a.organization_id = _org_id AND a.community_id = ANY(scope)
      ) x
    UNION ALL
    SELECT 'user', x.id FROM (
        SELECT p.current_sales_counselor_id AS id FROM public.wh_prospects p
         WHERE p.organization_id = _org_id AND p.community_id = ANY(scope)
        UNION
        SELECT p.original_sales_counselor_id FROM public.wh_prospects p
         WHERE p.organization_id = _org_id AND p.community_id = ANY(scope)
        UNION
        SELECT a.user_id_source FROM public.wh_activities a
         WHERE a.organization_id = _org_id AND a.community_id = ANY(scope)
        UNION
        SELECT h.sales_counselor_id FROM public.wh_housing_contracts h
         WHERE h.organization_id = _org_id AND h.community_id = ANY(scope)
      ) x
  ), cleaned AS (
    SELECT DISTINCT r.lt, btrim(r.id) AS id
      FROM refs r
     WHERE r.id IS NOT NULL AND btrim(r.id) <> ''
  ), joined AS (
    SELECT c.lt,
           c.id,
           EXISTS (
             SELECT 1
               FROM public.wh_lookups l
               JOIN public.data_source_connections dc ON dc.id = l.connection_id
              WHERE dc.organization_id = _org_id
                AND l.lookup_type = c.lt
                AND l.source_id = c.id
                AND COALESCE(NULLIF(btrim(l.label), ''), '') <> ''
           ) AS ok
      FROM cleaned c
  )
  SELECT j.lt,
         count(*)::int,
         count(*) FILTER (WHERE j.ok)::int,
         count(*) FILTER (WHERE NOT j.ok)::int,
         COALESCE(array_agg(j.id ORDER BY j.id) FILTER (WHERE NOT j.ok), ARRAY[]::text[])
    FROM joined j
   GROUP BY j.lt
   ORDER BY j.lt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wh_lookup_coverage(uuid, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_lookup_coverage(uuid, uuid[]) TO authenticated;
