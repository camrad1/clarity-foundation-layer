DROP FUNCTION IF EXISTS public.wh_flash_hot_leads(uuid, uuid[], integer, integer);
-- Canonical Hot-score predicate. WelcomeHome's Prospects export supplies
-- `scores_name` but no `scores_id`, so wh_prospects.score_id is NULL for every
-- row; matching on score_id alone yielded zero Hot leads everywhere. The
-- canonical rule now matches the configured semantic mappings by id OR by
-- label (case-insensitive), so any source score mapped to 'hot'
-- (e.g. "Hot", "Hot - No Lead Nurturing") qualifies. Nothing is hard-coded.
CREATE OR REPLACE FUNCTION public.wh_is_hot_score(_org_id uuid, _score_id text, _score_label text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wh_score_mappings sm
     WHERE sm.organization_id = _org_id
       AND sm.level = 'hot'
       AND (
         (_score_id IS NOT NULL AND sm.score_id = _score_id)
         OR (_score_label IS NOT NULL AND lower(btrim(sm.score_label)) = lower(btrim(_score_label)))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.wh_is_hot_score(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Flash Hot Lead tracker: current-state working list. Never filtered by
-- inquiry date, month or Flash week. Countable = not merged, not discarded,
-- prospect still open (moved-in / closed prospects are no longer working leads).
CREATE OR REPLACE FUNCTION public.wh_flash_hot_leads(_org_id uuid, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(source_id text, community_id uuid, person_name text, stage_id text, stage_label text, score_label text, status text, inquiry_date date, next_activity_scheduled_at timestamp with time zone, last_contact_at timestamp with time zone, counselor_id text, lead_source_id text, lead_source_label text, total_count bigint)
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
           pr.next_activity_scheduled_at, pr.last_contact_at,
           pr.current_sales_counselor_id AS counselor_id,
           pr.lead_source_id, pr.lead_source_label
      FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) = 'open'
       AND public.wh_is_hot_score(_org_id, pr.score_id, pr.score_label)
  )
  SELECT f.source_id, f.community_id, f.person_name, f.stage_id, f.stage_label, f.score_label,
         f.status, f.inquiry_date, f.next_activity_scheduled_at, f.last_contact_at,
         f.counselor_id, f.lead_source_id, f.lead_source_label,
         (SELECT count(*) FROM f)
    FROM f ORDER BY f.next_activity_scheduled_at NULLS LAST, f.source_id
   LIMIT _limit OFFSET _offset;
END; $function$;

REVOKE ALL ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_flash_hot_leads(uuid, uuid[], integer, integer) TO authenticated;

-- Sales Intelligence drill-through: same canonical Hot rule as Flash.
CREATE OR REPLACE FUNCTION public.wh_prospect_page(_org_id uuid, _bucket text, _community_ids uuid[] DEFAULT NULL::uuid[], _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, source_id text, person_name text, community_id uuid, stage_id text, score_id text, status text, next_activity_scheduled_at timestamp with time zone, last_contact_at timestamp with time zone, current_sales_counselor_id text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; scope uuid[]; now_ts timestamptz := now();
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

  RETURN QUERY
  WITH o AS (
    SELECT pr.id, pr.source_id, pr.community_id, pr.stage_id, pr.score_id, pr.score_label, pr.status,
           pr.next_activity_scheduled_at, pr.last_contact_at, pr.current_sales_counselor_id,
           pr.created_at_source,
           (lower(COALESCE(pr.status, '')) = 'open'
            AND public.wh_is_hot_score(_org_id, pr.score_id, pr.score_label)) AS is_hot
      FROM public.wh_prospects pr
     WHERE pr.organization_id = _org_id AND pr.community_id = ANY(scope)
       AND pr.discarded_at IS NULL AND pr.merged_into_prospect_id IS NULL
       AND lower(COALESCE(pr.status, '')) NOT IN ('closed', 'lost', 'inactive')
  ), sel AS (
    SELECT * FROM o WHERE CASE _bucket
      WHEN 'overdue' THEN o.next_activity_scheduled_at IS NOT NULL AND o.next_activity_scheduled_at < now_ts
      WHEN 'hot' THEN o.is_hot
      WHEN 'hot_no_activity' THEN o.is_hot
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

-- Sales Intelligence summary: apply the same canonical Hot rule in place,
-- leaving every other metric in wh_sales_summary byte-identical.
DO $do$
DECLARE def text; new_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wh_sales_summary';
  IF def IS NULL THEN RAISE EXCEPTION 'wh_sales_summary not found'; END IF;

  new_def := replace(def,
    'pr.status, pr.stage_id, pr.score_id,',
    'pr.status, pr.stage_id, pr.score_id, pr.score_label,');
  IF new_def = def THEN RAISE EXCEPTION 'score_label projection anchor not found'; END IF;

  def := new_def;
  new_def := replace(def,
    'hot_ids IS NOT NULL AND score_id = ANY(hot_ids)',
    'lower(COALESCE(status, '''')) = ''open'' AND public.wh_is_hot_score(_org_id, score_id, score_label)');
  IF new_def = def THEN RAISE EXCEPTION 'hot predicate anchor not found'; END IF;

  EXECUTE new_def;
END $do$;