
CREATE OR REPLACE FUNCTION public.wh_flash_notices(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[],
  _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, resident_source_id text,
              notice_date date, expected_move_out_date date, care_type text, unit_label text,
              reason text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; today date := current_date;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN QUERY
  WITH r AS (
    SELECT hc.source_id AS c_source_id, hc.community_id AS c_community_id,
           hc.resident_source_id AS c_resident_source_id,
           hc.notice_date AS c_notice_date,
           COALESCE(hc.financial_move_out_date, hc.move_out_date) AS c_mo_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS c_care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''), hc.unit_source_id) AS c_unit_label,
           NULLIF(btrim(hc.move_out_reason_label), '') AS c_reason
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  ), f AS (
    SELECT * FROM r
     WHERE (r.c_mo_date BETWEEN _start AND _end AND r.c_mo_date > today)
        OR (r.c_notice_date IS NOT NULL AND r.c_mo_date IS NULL
            AND r.c_notice_date BETWEEN _start AND _end)
  )
  SELECT f.c_source_id, f.c_community_id, f.c_resident_source_id, f.c_notice_date, f.c_mo_date,
         f.c_care_type, f.c_unit_label, f.c_reason, (SELECT count(*) FROM f)
    FROM f ORDER BY f.c_mo_date NULLS LAST, f.c_notice_date, f.c_source_id
   LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], int, int) TO authenticated;
