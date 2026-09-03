UPDATE public.wh_housing_contracts h
   SET person_name = x.nm
  FROM (
    SELECT DISTINCT ON (r.organization_id, r.payload->>'housing_contracts_id')
           r.organization_id,
           r.payload->>'housing_contracts_id' AS sid,
           NULLIF(btrim(concat_ws(' ',
             NULLIF(btrim(r.payload->>'people_first_name'), ''),
             NULLIF(btrim(r.payload->>'people_last_name'), ''))), '') AS nm
      FROM public.source_records_raw r
     WHERE r.record_type = 'HousingContracts'
       AND r.payload->>'housing_contracts_id' IS NOT NULL
     ORDER BY r.organization_id, r.payload->>'housing_contracts_id', r.created_at DESC
  ) x
 WHERE x.organization_id = h.organization_id
   AND x.sid = h.source_id
   AND x.nm IS NOT NULL
   AND h.person_name IS NULL;

UPDATE public.wh_prospects p
   SET display_name = y.person_name
  FROM (
    SELECT DISTINCT ON (organization_id, prospect_source_id)
           organization_id, prospect_source_id, person_name
      FROM public.wh_housing_contracts
     WHERE prospect_source_id IS NOT NULL AND person_name IS NOT NULL
     ORDER BY organization_id, prospect_source_id, updated_at_source DESC NULLS LAST
  ) y
 WHERE y.organization_id = p.organization_id
   AND y.prospect_source_id = p.source_id
   AND p.display_name IS NULL;