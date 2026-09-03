CREATE OR REPLACE FUNCTION public.wh_person_label(_org_id uuid, _prospect_source_id text, _resident_source_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(r.display_name), '') FROM public.wh_residents r
      WHERE r.organization_id = _org_id AND r.source_id = _resident_source_id
        AND NULLIF(btrim(r.display_name), '') IS NOT NULL LIMIT 1),
    (SELECT NULLIF(btrim(h.person_name), '') FROM public.wh_housing_contracts h
      WHERE h.organization_id = _org_id AND h.resident_source_id = _resident_source_id
        AND NULLIF(btrim(h.person_name), '') IS NOT NULL
      ORDER BY h.updated_at_source DESC NULLS LAST LIMIT 1),
    (SELECT NULLIF(btrim(h.person_name), '') FROM public.wh_housing_contracts h
      WHERE h.organization_id = _org_id AND h.prospect_source_id = _prospect_source_id
        AND NULLIF(btrim(h.person_name), '') IS NOT NULL
      ORDER BY h.updated_at_source DESC NULLS LAST LIMIT 1),
    (SELECT NULLIF(btrim(r.display_name), '') FROM public.wh_residents r
      WHERE r.organization_id = _org_id AND r.prospect_source_id = _prospect_source_id
        AND r.discarded_at IS NULL
        AND NULLIF(btrim(r.display_name), '') IS NOT NULL
      ORDER BY (r.first_resident IS TRUE) DESC, r.updated_at_source DESC NULLS LAST, r.source_id
      LIMIT 1),
    (SELECT NULLIF(btrim(p.display_name), '') FROM public.wh_prospects p
      WHERE p.organization_id = _org_id AND p.source_id = _prospect_source_id
        AND NULLIF(btrim(p.display_name), '') IS NOT NULL LIMIT 1)
  );
$function$;