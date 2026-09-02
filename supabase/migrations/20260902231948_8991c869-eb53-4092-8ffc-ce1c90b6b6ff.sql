
CREATE OR REPLACE FUNCTION public.flash_week_start(_d date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _d - ((EXTRACT(dow FROM _d)::int + 2) % 7)
$$;

CREATE OR REPLACE FUNCTION public.wh_flash_move_ins(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[],
  _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, prospect_source_id text, resident_source_id text,
              move_in_date date, care_type text, unit_label text, is_transfer boolean,
              monthly_rate numeric, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; mf text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT COALESCE(x.move_in_date_field, 'move_in_date') INTO mf
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  RETURN QUERY
  WITH rows AS (
    SELECT hc.source_id, hc.community_id, hc.prospect_source_id, hc.resident_source_id,
           (CASE WHEN mf = 'financial_move_in_date' THEN hc.financial_move_in_date
                 ELSE hc.move_in_date END) AS mi_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''), hc.unit_source_id) AS unit_label,
           hc.is_transfer, hc.monthly_rate
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
  ), f AS (SELECT * FROM rows WHERE mi_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.prospect_source_id, f.resident_source_id, f.mi_date,
         f.care_type, f.unit_label, f.is_transfer, f.monthly_rate, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mi_date, f.source_id LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_move_ins(uuid, date, date, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_move_ins(uuid, date, date, uuid[], int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.wh_flash_move_outs(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[],
  _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, resident_source_id text, prospect_source_id text,
              move_out_date date, notice_date date, care_type text, unit_label text,
              reason text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; mf text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT COALESCE(x.move_out_date_field, 'move_out_date') INTO mf
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  RETURN QUERY
  WITH rows AS (
    SELECT hc.source_id, hc.community_id, hc.resident_source_id, hc.prospect_source_id,
           (CASE WHEN mf = 'financial_move_out_date' THEN hc.financial_move_out_date
                 ELSE hc.move_out_date END) AS mo_date,
           hc.notice_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''), hc.unit_source_id) AS unit_label,
           COALESCE(NULLIF(btrim(hc.move_out_reason_label), ''),
                    (SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id
                        AND l.source_id = hc.move_out_reason_id
                        AND l.lookup_type ILIKE '%move%out%reason%' LIMIT 1)) AS reason
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_out IS TRUE
  ), f AS (SELECT * FROM rows WHERE mo_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.resident_source_id, f.prospect_source_id, f.mo_date,
         f.notice_date, f.care_type, f.unit_label, f.reason, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mo_date, f.source_id LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_move_outs(uuid, date, date, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_move_outs(uuid, date, date, uuid[], int, int) TO authenticated;

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
  WITH rows AS (
    SELECT hc.source_id, hc.community_id, hc.resident_source_id, hc.notice_date,
           COALESCE(hc.financial_move_out_date, hc.move_out_date) AS mo_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''), hc.unit_source_id) AS unit_label,
           NULLIF(btrim(hc.move_out_reason_label), '') AS reason
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL
  ), f AS (
    SELECT * FROM rows
     WHERE (mo_date BETWEEN _start AND _end AND mo_date > today)
        OR (notice_date IS NOT NULL AND mo_date IS NULL AND notice_date BETWEEN _start AND _end)
  )
  SELECT f.source_id, f.community_id, f.resident_source_id, f.notice_date, f.mo_date,
         f.care_type, f.unit_label, f.reason, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mo_date NULLS LAST, f.notice_date, f.source_id LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.wh_flash_deposits(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[],
  _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, depositor_key text, prospect_source_id text,
              deposit_date date, amount numeric, expected_move_in_date date,
              care_type text, unit_label text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN QUERY
  WITH f AS (
    SELECT dt.source_id, dt.community_id,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key,
           dt.prospect_source_id, dt.occurred_local_date AS deposit_date, dt.amount,
           hc.mi_date AS expected_move_in_date, hc.care_type, hc.unit_label
      FROM public.wh_deposit_transactions dt
      LEFT JOIN LATERAL (
        SELECT COALESCE(h.financial_move_in_date, h.move_in_date) AS mi_date,
               COALESCE(NULLIF(btrim(h.care_type_label), ''), 'Unspecified') AS care_type,
               COALESCE(NULLIF(btrim(h.unit_number), ''), h.unit_source_id) AS unit_label
          FROM public.wh_housing_contracts h
         WHERE h.organization_id = dt.organization_id
           AND h.prospect_source_id IS NOT NULL
           AND h.prospect_source_id = dt.prospect_source_id
           AND h.lease_canceled_on IS NULL
         ORDER BY COALESCE(h.financial_move_in_date, h.move_in_date) DESC NULLS LAST
         LIMIT 1) hc ON true
     WHERE dt.organization_id = _org_id AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit' AND dt.deposit_type = 'Deposit'
       AND dt.occurred_local_date BETWEEN _start AND _end
  )
  SELECT f.source_id, f.community_id, f.depositor_key, f.prospect_source_id, f.deposit_date,
         f.amount, f.expected_move_in_date, f.care_type, f.unit_label, (SELECT count(*) FROM f)
    FROM f ORDER BY f.deposit_date, f.source_id LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_deposits(uuid, date, date, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_deposits(uuid, date, date, uuid[], int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.wh_flash_hot_leads(
  _org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[],
  _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, stage text, status text,
              next_activity_scheduled_at timestamptz, last_contact_at timestamptz,
              counselor text, lead_source text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid[]; hot_ids text[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT array_agg(sm.score_id) INTO hot_ids
    FROM public.wh_score_mappings sm
   WHERE sm.organization_id = _org_id AND sm.level = 'hot';
  RETURN QUERY
  WITH f AS (
    SELECT pr.source_id, pr.community_id,
           COALESCE((SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id AND l.source_id = pr.stage_id
                        AND l.lookup_type ILIKE '%stage%' LIMIT 1), pr.stage_id) AS stage,
           pr.status, pr.next_activity_scheduled_at, pr.last_contact_at,
           pr.current_sales_counselor_id AS counselor,
           pr.lead_source_id AS lead_source
      FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) NOT IN ('closed', 'lost', 'inactive')
       AND hot_ids IS NOT NULL AND pr.score_id = ANY(hot_ids)
  )
  SELECT f.source_id, f.community_id, f.stage, f.status, f.next_activity_scheduled_at,
         f.last_contact_at, f.counselor, f.lead_source, (SELECT count(*) FROM f)
    FROM f ORDER BY f.next_activity_scheduled_at NULLS LAST, f.source_id
   LIMIT _limit OFFSET _offset;
END; $$;
REVOKE EXECUTE ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], int, int) TO authenticated;
