
-- Readable WelcomeHome user (staff) label
CREATE OR REPLACE FUNCTION public.wh_user_label(_org_id uuid, _user_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NULLIF(btrim(regexp_replace(l.label, '\s+', ' ', 'g')), '')
    FROM public.wh_lookups l
   WHERE l.organization_id = _org_id
     AND l.lookup_type = 'user'
     AND l.source_id = _user_id
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.wh_user_label(uuid, text) FROM PUBLIC, anon, authenticated;

-- HOT LEADS: counselor, last contact, next activity
DROP FUNCTION IF EXISTS public.wh_flash_hot_leads(uuid, uuid[], integer, integer);
CREATE OR REPLACE FUNCTION public.wh_flash_hot_leads(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, person_name text, stage_id text, stage_label text, score_label text, status text, inquiry_date date, next_activity_scheduled_at timestamp with time zone, next_activity_type text, last_contact_at timestamp with time zone, counselor_id text, counselor_name text, lead_source_id text, lead_source_label text, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE scope uuid[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN QUERY
  WITH f AS (
    SELECT pr.source_id, pr.community_id,
           public.wh_person_label(_org_id, pr.source_id, NULL) AS person_name,
           pr.stage_id, pr.stage_label, pr.score_label, pr.status, pr.inquiry_date,
           nxt.scheduled_at AS next_activity_scheduled_at,
           nxt.activity_type_label AS next_activity_type,
           COALESCE(pr.last_contact_at, lst.completed_at) AS last_contact_at,
           COALESCE(pr.current_sales_counselor_id, lst.counselor_id) AS counselor_id,
           COALESCE(
             public.wh_user_label(_org_id, pr.current_sales_counselor_id),
             public.wh_user_label(_org_id, lst.counselor_id)
           ) AS counselor_name,
           pr.lead_source_id, pr.lead_source_label
      FROM public.wh_prospects pr
      LEFT JOIN LATERAL (
        SELECT a.scheduled_at, a.activity_type_label
          FROM public.wh_activities a
         WHERE a.organization_id = pr.organization_id
           AND a.prospect_source_id = pr.source_id
           AND a.discarded_at IS NULL
           AND a.completed_at IS NULL
           AND a.scheduled_at IS NOT NULL
           AND a.scheduled_at > now()
         ORDER BY a.scheduled_at
         LIMIT 1) nxt ON true
      LEFT JOIN LATERAL (
        SELECT a.completed_at, COALESCE(a.user_id_source, a.assigned_to_id) AS counselor_id
          FROM public.wh_activities a
         WHERE a.organization_id = pr.organization_id
           AND a.prospect_source_id = pr.source_id
           AND a.discarded_at IS NULL
           AND a.completed_at IS NOT NULL
         ORDER BY a.completed_at DESC
         LIMIT 1) lst ON true
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) = 'open'
       AND public.wh_is_hot_score(_org_id, pr.score_id, pr.score_label)
  )
  SELECT f.source_id, f.community_id, f.person_name, f.stage_id, f.stage_label, f.score_label,
         f.status, f.inquiry_date, f.next_activity_scheduled_at, f.next_activity_type,
         f.last_contact_at, f.counselor_id, f.counselor_name,
         f.lead_source_id, f.lead_source_label,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.next_activity_scheduled_at NULLS LAST, f.source_id
   LIMIT _limit OFFSET _offset;
END; $function$;

-- MOVE INS: care type / unit resolution via units
CREATE OR REPLACE FUNCTION public.wh_flash_move_ins(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, prospect_source_id text, resident_source_id text, person_name text, move_in_date date, care_type text, unit_label text, is_transfer boolean, monthly_rate numeric, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; mf text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT COALESCE(x.move_in_date_field, 'move_in_date') INTO mf
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  RETURN QUERY
  WITH rows AS (
    SELECT hc.source_id, hc.community_id, hc.prospect_source_id, hc.resident_source_id,
           public.wh_person_label(_org_id, hc.prospect_source_id, hc.resident_source_id) AS person_name,
           (CASE WHEN mf = 'financial_move_in_date' THEN hc.financial_move_in_date
                 ELSE hc.move_in_date END) AS mi_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''),
                    NULLIF(btrim(u.care_type_label), ''),
                    (SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id AND l.lookup_type = 'care_type'
                        AND l.source_id = u.care_type_id_source LIMIT 1),
                    'Unspecified') AS care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''),
                    NULLIF(btrim(u.unit_number), ''),
                    NULLIF(btrim(u.unit_name), '')) AS unit_label,
           hc.is_transfer, hc.monthly_rate
      FROM public.wh_housing_contracts hc
      LEFT JOIN public.wh_units u
        ON u.organization_id = hc.organization_id AND u.source_id = hc.unit_source_id
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
  ), f AS (SELECT * FROM rows WHERE mi_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.prospect_source_id, f.resident_source_id, f.person_name,
         f.mi_date, f.care_type, f.unit_label, f.is_transfer, f.monthly_rate, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mi_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;

-- MOVE OUTS: same resolution
CREATE OR REPLACE FUNCTION public.wh_flash_move_outs(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, resident_source_id text, prospect_source_id text, person_name text, move_out_date date, notice_date date, care_type text, unit_label text, reason text, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; mf text;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT COALESCE(x.move_out_date_field, 'move_out_date') INTO mf
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;
  RETURN QUERY
  WITH rows AS (
    SELECT hc.source_id, hc.community_id, hc.resident_source_id, hc.prospect_source_id,
           public.wh_person_label(_org_id, hc.prospect_source_id, hc.resident_source_id) AS person_name,
           (CASE WHEN mf = 'financial_move_out_date' THEN hc.financial_move_out_date
                 ELSE hc.move_out_date END) AS mo_date,
           hc.notice_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''),
                    NULLIF(btrim(u.care_type_label), ''),
                    (SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id AND l.lookup_type = 'care_type'
                        AND l.source_id = u.care_type_id_source LIMIT 1),
                    'Unspecified') AS care_type,
           COALESCE(NULLIF(btrim(hc.unit_number), ''),
                    NULLIF(btrim(u.unit_number), ''),
                    NULLIF(btrim(u.unit_name), '')) AS unit_label,
           COALESCE(NULLIF(btrim(hc.move_out_reason_label), ''),
                    (SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id AND l.source_id = hc.move_out_reason_id
                        AND l.lookup_type ILIKE '%move%out%reason%' LIMIT 1)) AS reason
      FROM public.wh_housing_contracts hc
      LEFT JOIN public.wh_units u
        ON u.organization_id = hc.organization_id AND u.source_id = hc.unit_source_id
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_out IS TRUE
  ), f AS (SELECT * FROM rows WHERE mo_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.resident_source_id, f.prospect_source_id, f.person_name,
         f.mo_date, f.notice_date, f.care_type, f.unit_label, f.reason, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mo_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;

-- DEPOSITS: expected (future) move-in date + care type / unit resolution
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
           AND h.prospect_source_id IS NOT NULL
           AND h.prospect_source_id = dt.prospect_source_id
           AND h.lease_canceled_on IS NULL
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

REVOKE ALL ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) TO authenticated;
