-- 1. Name storage. Names only; all other personal data stays stripped.
ALTER TABLE public.wh_housing_contracts ADD COLUMN IF NOT EXISTS person_name text;
ALTER TABLE public.wh_residents ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.wh_prospects ADD COLUMN IF NOT EXISTS display_name text;

-- 2. Backfill contract person names from the raw records already captured.
UPDATE public.wh_housing_contracts h
   SET person_name = NULLIF(btrim(concat_ws(' ',
         NULLIF(btrim(r.payload->>'people_first_name'), ''),
         NULLIF(btrim(r.payload->>'people_last_name'), ''))), '')
  FROM public.source_records_raw r
 WHERE r.id = h.raw_record_id
   AND h.person_name IS NULL
   AND COALESCE(NULLIF(btrim(r.payload->>'people_first_name'), ''),
                NULLIF(btrim(r.payload->>'people_last_name'), '')) IS NOT NULL;

-- Prospect names are not present in the Prospects export; derive them from the
-- linked contract when one exists.
UPDATE public.wh_prospects p
   SET display_name = x.person_name
  FROM (
    SELECT DISTINCT ON (organization_id, prospect_source_id)
           organization_id, prospect_source_id, person_name
      FROM public.wh_housing_contracts
     WHERE prospect_source_id IS NOT NULL AND person_name IS NOT NULL
     ORDER BY organization_id, prospect_source_id, updated_at_source DESC NULLS LAST
  ) x
 WHERE x.organization_id = p.organization_id
   AND x.prospect_source_id = p.source_id
   AND p.display_name IS NULL;

CREATE INDEX IF NOT EXISTS wh_hc_person_prospect_idx
  ON public.wh_housing_contracts (organization_id, prospect_source_id)
  WHERE person_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS wh_hc_person_resident_idx
  ON public.wh_housing_contracts (organization_id, resident_source_id)
  WHERE person_name IS NOT NULL;

-- 3. Shared person-name resolver. Resident name first, then the contract
-- person, then the prospect. Returns NULL when nothing readable exists so the
-- interface can show a neutral fallback instead of a raw source id.
CREATE OR REPLACE FUNCTION public.wh_person_label(_org_id uuid, _prospect_source_id text, _resident_source_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    (SELECT NULLIF(btrim(p.display_name), '') FROM public.wh_prospects p
      WHERE p.organization_id = _org_id AND p.source_id = _prospect_source_id
        AND NULLIF(btrim(p.display_name), '') IS NOT NULL LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.wh_person_label(uuid, text, text) FROM PUBLIC, anon;

-- 4. Detail lists now carry the readable person name. Counting logic unchanged.
DROP FUNCTION IF EXISTS public.wh_prospect_page(uuid, text, uuid[], integer, integer);
CREATE FUNCTION public.wh_prospect_page(_org_id uuid, _bucket text, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, source_id text, person_name text, community_id uuid, stage_id text, score_id text, status text, next_activity_scheduled_at timestamptz, last_contact_at timestamptz, current_sales_counselor_id text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s record; scope uuid[]; hot_ids text[]; now_ts timestamptz := now();
  lim int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
  off int := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  SELECT array_agg(c.id) INTO scope FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR COALESCE(array_length(_community_ids,1),0)=0 OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  SELECT COALESCE(x.stalled_threshold_days, 14) AS stalled_threshold_days,
         COALESCE(x.hot_no_activity_mode, 'none_scheduled') AS hot_no_activity_mode,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  SELECT array_agg(sm.score_id) INTO hot_ids FROM public.wh_score_mappings sm
   WHERE sm.organization_id = _org_id AND sm.level = 'hot';

  RETURN QUERY
  WITH o AS (
    SELECT pr.id, pr.source_id, pr.community_id, pr.stage_id, pr.score_id, pr.status,
           pr.next_activity_scheduled_at, pr.last_contact_at, pr.current_sales_counselor_id,
           pr.created_at_source
      FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) NOT IN ('closed', 'lost', 'inactive')
  ), sel AS (
    SELECT * FROM o WHERE CASE _bucket
      WHEN 'overdue' THEN o.next_activity_scheduled_at IS NOT NULL AND o.next_activity_scheduled_at < now_ts
      WHEN 'hot' THEN hot_ids IS NOT NULL AND o.score_id = ANY(hot_ids)
      WHEN 'hot_no_activity' THEN hot_ids IS NOT NULL AND o.score_id = ANY(hot_ids)
        AND (o.next_activity_scheduled_at IS NULL
             OR (s.hot_no_activity_mode = 'none_or_overdue' AND o.next_activity_scheduled_at < now_ts))
      WHEN 'stalled' THEN COALESCE(o.last_contact_at, o.created_at_source) IS NULL
        OR COALESCE(o.last_contact_at, o.created_at_source) < now_ts - make_interval(days => s.stalled_threshold_days)
      ELSE true END
  )
  SELECT sel.id, sel.source_id, public.wh_person_label(_org_id, sel.source_id, NULL),
         sel.community_id, sel.stage_id, sel.score_id, sel.status,
         sel.next_activity_scheduled_at, sel.last_contact_at, sel.current_sales_counselor_id,
         count(*) OVER ()
    FROM sel ORDER BY sel.next_activity_scheduled_at NULLS LAST, sel.source_id
   LIMIT lim OFFSET off;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_prospect_page(uuid, text, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_tour_page(uuid, date, date, uuid[], text, integer, integer);
CREATE FUNCTION public.wh_tour_page(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _mode text DEFAULT 'successful'::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, source_id text, community_id uuid, prospect_source_id text, person_name text, activity_type_label text, result_label text, successful boolean, first_completed_of_type boolean, completed_local_date date, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[]; tour_ids text[]; ok_ids text[];
  lim int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
  off int := GREATEST(COALESCE(_offset, 0), 0);
  mode text := CASE WHEN _mode = 'all' THEN 'all' ELSE 'successful' END;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  SELECT array_agg(c.id) INTO scope FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR COALESCE(array_length(_community_ids,1),0)=0 OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  SELECT array_agg(m.activity_type_id) INTO tour_ids FROM public.wh_activity_type_mappings m
   WHERE m.organization_id = _org_id AND m.category = 'tour';
  tour_ids := COALESCE(tour_ids, ARRAY[]::text[]);
  ok_ids := public.wh_successful_result_ids(_org_id);

  RETURN QUERY
  SELECT ac.id, ac.source_id, ac.community_id, ac.prospect_source_id,
         public.wh_person_label(_org_id, ac.prospect_source_id, NULL),
         ac.activity_type_label, ac.result_label,
         (ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)) AS successful,
         ac.first_completed_of_type, ac.completed_local_date, count(*) OVER ()
    FROM public.wh_activities ac
   WHERE ac.organization_id = _org_id AND ac.community_id = ANY(scope)
     AND ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
     AND ac.completed_local_date BETWEEN _start AND _end
     AND ac.activity_type_id = ANY(tour_ids)
     AND (mode = 'all' OR (ac.result_id IS NOT NULL AND ac.result_id = ANY(ok_ids)))
   ORDER BY ac.completed_local_date DESC, ac.source_id
   LIMIT lim OFFSET off;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_tour_page(uuid, date, date, uuid[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_tour_page(uuid, date, date, uuid[], text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_deposit_page(uuid, date, date, uuid[], integer, integer);
CREATE FUNCTION public.wh_deposit_page(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, source_id text, community_id uuid, prospect_source_id text, person_name text, transaction_type text, deposit_type text, amount numeric, occurred_local_date date, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[];
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO scope FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR COALESCE(array_length(_community_ids,1),0)=0 OR c.id = ANY(_community_ids));

  RETURN QUERY
  WITH std AS (
    SELECT dt.*, COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS depositor_key
      FROM public.wh_deposit_transactions dt
     WHERE dt.organization_id = _org_id AND dt.community_id = ANY(scope)
       AND dt.discarded_at IS NULL AND dt.transaction_type = 'Deposit'
       AND dt.deposit_type = 'Deposit' AND COALESCE(dt.amount, 0) > 0
       AND dt.occurred_local_date BETWEEN _start AND _end
  ), one_per AS (
    SELECT DISTINCT ON (community_id, depositor_key)
           std.id, std.source_id, std.community_id, std.depositor_key,
           std.prospect_source_id, std.resident_source_id, std.transaction_type,
           std.deposit_type, std.amount, std.occurred_local_date
      FROM std ORDER BY community_id, depositor_key, occurred_local_date, source_id
  )
  SELECT o.id, o.source_id, o.community_id, o.prospect_source_id,
         public.wh_person_label(_org_id, o.prospect_source_id, o.resident_source_id),
         o.transaction_type, o.deposit_type, o.amount, o.occurred_local_date, count(*) OVER ()
    FROM one_per o ORDER BY o.occurred_local_date, o.source_id
   LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_deposit_page(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_deposit_page(uuid, date, date, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_move_in_page(uuid, date, date, uuid[], text, integer, integer);
CREATE FUNCTION public.wh_move_in_page(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _mode text DEFAULT 'move_in'::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, source_id text, community_id uuid, prospect_source_id text, person_name text, unit_source_id text, unit_label text, care_type text, financial_move_in_date date, status text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[];
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO scope FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR COALESCE(array_length(_community_ids,1),0)=0 OR c.id = ANY(_community_ids));

  RETURN QUERY
  WITH base AS (
    SELECT hc.id, hc.source_id, hc.community_id, hc.prospect_source_id, hc.resident_source_id,
           hc.unit_source_id,
           NULLIF(btrim(hc.unit_number), '') AS unit_label,
           NULLIF(btrim(hc.care_type_label), '') AS care_type,
           hc.financial_move_in_date, hc.status
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.discarded_at IS NULL AND hc.lease_canceled_on IS NULL
       AND hc.financial_move_in_date BETWEEN _start AND _end
       AND (CASE WHEN _mode = 'transfer_in' THEN COALESCE(hc.count_move_in, false) = false
                 ELSE hc.count_move_in IS TRUE END)
  )
  SELECT b.id, b.source_id, b.community_id, b.prospect_source_id,
         public.wh_person_label(_org_id, b.prospect_source_id, b.resident_source_id),
         b.unit_source_id, b.unit_label, b.care_type, b.financial_move_in_date, b.status,
         count(*) OVER ()
    FROM base b ORDER BY b.financial_move_in_date, b.source_id
   LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_move_in_page(uuid, date, date, uuid[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_move_in_page(uuid, date, date, uuid[], text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_flash_move_ins(uuid, date, date, uuid[], integer, integer);
CREATE FUNCTION public.wh_flash_move_ins(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, prospect_source_id text, resident_source_id text, person_name text, move_in_date date, care_type text, unit_label text, is_transfer boolean, monthly_rate numeric, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS care_type,
           NULLIF(btrim(hc.unit_number), '') AS unit_label,
           hc.is_transfer, hc.monthly_rate
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
  ), f AS (SELECT * FROM rows WHERE mi_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.prospect_source_id, f.resident_source_id, f.person_name,
         f.mi_date, f.care_type, f.unit_label, f.is_transfer, f.monthly_rate, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mi_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_flash_move_ins(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_move_ins(uuid, date, date, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_flash_move_outs(uuid, date, date, uuid[], integer, integer);
CREATE FUNCTION public.wh_flash_move_outs(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, resident_source_id text, prospect_source_id text, person_name text, move_out_date date, notice_date date, care_type text, unit_label text, reason text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS care_type,
           NULLIF(btrim(hc.unit_number), '') AS unit_label,
           COALESCE(NULLIF(btrim(hc.move_out_reason_label), ''),
                    (SELECT l.label FROM public.wh_lookups l
                      WHERE l.organization_id = _org_id AND l.source_id = hc.move_out_reason_id
                        AND l.lookup_type ILIKE '%move%out%reason%' LIMIT 1)) AS reason
      FROM public.wh_housing_contracts hc
     WHERE hc.organization_id = _org_id AND hc.community_id = ANY(scope)
       AND hc.lease_canceled_on IS NULL AND hc.count_move_out IS TRUE
  ), f AS (SELECT * FROM rows WHERE mo_date BETWEEN _start AND _end)
  SELECT f.source_id, f.community_id, f.resident_source_id, f.prospect_source_id, f.person_name,
         f.mo_date, f.notice_date, f.care_type, f.unit_label, f.reason, (SELECT count(*) FROM f)
    FROM f ORDER BY f.mo_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_flash_move_outs(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_move_outs(uuid, date, date, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_flash_notices(uuid, date, date, uuid[], integer, integer);
CREATE FUNCTION public.wh_flash_notices(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, resident_source_id text, person_name text, notice_date date, expected_move_out_date date, care_type text, unit_label text, reason text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; today date := current_date;
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  RETURN QUERY
  WITH r AS (
    SELECT hc.source_id AS c_source_id, hc.community_id AS c_community_id,
           hc.resident_source_id AS c_resident_source_id,
           public.wh_person_label(_org_id, hc.prospect_source_id, hc.resident_source_id) AS c_person_name,
           hc.notice_date AS c_notice_date,
           COALESCE(hc.financial_move_out_date, hc.move_out_date) AS c_mo_date,
           COALESCE(NULLIF(btrim(hc.care_type_label), ''), 'Unspecified') AS c_care_type,
           NULLIF(btrim(hc.unit_number), '') AS c_unit_label,
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
  SELECT f.c_source_id, f.c_community_id, f.c_resident_source_id, f.c_person_name,
         f.c_notice_date, f.c_mo_date, f.c_care_type, f.c_unit_label, f.c_reason,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.c_mo_date NULLS LAST, f.c_notice_date, f.c_source_id
   LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_notices(uuid, date, date, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_flash_deposits(uuid, date, date, uuid[], integer, integer);
CREATE FUNCTION public.wh_flash_deposits(_org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, depositor_key text, prospect_source_id text, person_name text, deposit_date date, amount numeric, expected_move_in_date date, care_type text, unit_label text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
        SELECT COALESCE(h.financial_move_in_date, h.move_in_date) AS mi_date,
               COALESCE(NULLIF(btrim(h.care_type_label), ''), 'Unspecified') AS care_type,
               NULLIF(btrim(h.unit_number), '') AS unit_label
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
  SELECT f.source_id, f.community_id, f.depositor_key, f.prospect_source_id, f.person_name,
         f.deposit_date, f.amount, f.expected_move_in_date, f.care_type, f.unit_label,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.deposit_date, f.source_id LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_flash_deposits(uuid, date, date, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_deposits(uuid, date, date, uuid[], integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.wh_flash_hot_leads(uuid, uuid[], integer, integer);
CREATE FUNCTION public.wh_flash_hot_leads(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, person_name text, stage_id text, status text, next_activity_scheduled_at timestamptz, last_contact_at timestamptz, counselor_id text, lead_source_id text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE scope uuid[]; hot_ids text[];
BEGIN
  scope := public.wh_flash_scope(_org_id, _community_ids);
  SELECT array_agg(sm.score_id) INTO hot_ids FROM public.wh_score_mappings sm
   WHERE sm.organization_id = _org_id AND sm.level = 'hot';
  RETURN QUERY
  WITH f AS (
    SELECT pr.source_id, pr.community_id,
           public.wh_person_label(_org_id, pr.source_id, NULL) AS person_name,
           pr.stage_id, pr.status, pr.next_activity_scheduled_at, pr.last_contact_at,
           pr.current_sales_counselor_id AS counselor_id, pr.lead_source_id
      FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) NOT IN ('closed', 'lost', 'inactive')
       AND hot_ids IS NOT NULL AND pr.score_id = ANY(hot_ids)
  )
  SELECT f.source_id, f.community_id, f.person_name, f.stage_id, f.status,
         f.next_activity_scheduled_at, f.last_contact_at, f.counselor_id, f.lead_source_id,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.next_activity_scheduled_at NULLS LAST, f.source_id
   LIMIT _limit OFFSET _offset;
END; $function$;
REVOKE ALL ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) TO authenticated;