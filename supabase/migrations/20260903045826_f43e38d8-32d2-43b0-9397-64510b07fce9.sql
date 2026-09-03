CREATE OR REPLACE FUNCTION public.wh_flash_deposits(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, depositor_key text, prospect_source_id text, person_name text, deposit_date date, amount numeric, expected_move_in_date date, care_type text, unit_label text, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN QUERY
  WITH f AS (
    SELECT dt.source_id, dt.community_id,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key,
           dt.prospect_source_id,
           public.wh_person_label(_org_id, dt.prospect_source_id, dt.resident_source_id) AS person_name,
           dt.occurred_local_date AS deposit_date, dt.amount,
           hc.mi_date AS expected_move_in_date, hc.care_type, hc.unit_label
      FROM public.wh_deposit_transactions dt
      LEFT JOIN LATERAL (
        SELECT COALESCE(h.move_in_date, h.financial_move_in_date) AS mi_date,
               COALESCE(NULLIF(btrim(h.care_type_label), ''),
                        NULLIF(btrim(u.care_type_label), ''),
                        (SELECT l.label FROM public.wh_lookups l
                          WHERE l.organization_id = _org_id AND l.lookup_type = 'care_type'
                            AND l.source_id = u.care_type_id_source LIMIT 1),
                        'Unspecified') AS care_type,
               COALESCE(NULLIF(btrim(h.unit_number), ''),
                        NULLIF(btrim(u.unit_number), ''),
                        NULLIF(btrim(u.unit_name), '')) AS unit_label
          FROM public.wh_housing_contracts h
          LEFT JOIN public.wh_units u
            ON u.organization_id = h.organization_id AND u.source_id = h.unit_source_id
         WHERE h.organization_id = dt.organization_id
           AND h.lease_canceled_on IS NULL
           AND (
             (dt.prospect_source_id IS NOT NULL AND h.prospect_source_id = dt.prospect_source_id)
             OR (dt.resident_source_id IS NOT NULL AND h.resident_source_id = dt.resident_source_id)
             OR (dt.resident_source_id IS NOT NULL AND h.resident_source_ids IS NOT NULL
                 AND dt.resident_source_id = ANY(string_to_array(replace(h.resident_source_ids, ' ', ''), ',')))
           )
         ORDER BY COALESCE(h.move_in_date, h.financial_move_in_date) DESC NULLS LAST
         LIMIT 1) hc ON true
     WHERE dt.organization_id = _org_id AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit' AND dt.deposit_type = 'Deposit'
       AND dt.occurred_local_date BETWEEN _start AND _end
  )
  SELECT f.source_id, f.community_id, f.depositor_key, f.prospect_source_id, f.person_name,
         f.deposit_date, f.amount, f.expected_move_in_date, f.care_type, f.unit_label,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.deposit_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;