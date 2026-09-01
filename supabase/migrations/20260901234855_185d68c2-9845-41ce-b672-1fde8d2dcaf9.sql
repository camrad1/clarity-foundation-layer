-- 1. Unclassified semantics: no matching rule => NULL
CREATE OR REPLACE FUNCTION public.gsc_classify_query(_org_id uuid, _query text)
 RETURNS query_classification
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.classification FROM public.gsc_query_classification_rules r
   WHERE r.organization_id = _org_id AND r.active
     AND (
       (r.match_type = 'exact_phrase' AND lower(_query) = lower(r.pattern))
    OR (r.match_type = 'contains'     AND position(lower(r.pattern) in lower(_query)) > 0)
    OR (r.match_type = 'starts_with'  AND lower(_query) LIKE lower(r.pattern) || '%')
    OR (r.match_type = 'regex'        AND _query ~* r.pattern)
     )
   ORDER BY r.priority ASC, r.created_at ASC
   LIMIT 1;
$function$;

-- 2. Tenant/ownership hardening on the report RPCs (still SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.gsc_query_report(_org_id uuid, _import_id uuid, _compare_import_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(query text, normalized_query text, clicks integer, impressions integer, ctr numeric, position_value numeric, classification query_classification, prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.query, c.normalized_query, c.clicks, c.impressions, c.ctr, c.position,
         public.gsc_classify_query(_org_id, c.query),
         p.clicks, p.impressions, p.ctr, p.position
    FROM public.gsc_query_facts c
    JOIN public.gsc_imports ci
      ON ci.id = c.import_id AND ci.organization_id = _org_id AND ci.import_status <> 'failed'
    LEFT JOIN public.gsc_query_facts p
      ON _compare_import_id IS NOT NULL
     AND p.import_id = _compare_import_id
     AND p.organization_id = _org_id
     AND p.normalized_query = c.normalized_query
     AND EXISTS (SELECT 1 FROM public.gsc_imports pi
                  WHERE pi.id = _compare_import_id AND pi.organization_id = _org_id
                    AND pi.import_status <> 'failed')
   WHERE c.organization_id = _org_id AND c.import_id = _import_id;
$function$;

CREATE OR REPLACE FUNCTION public.gsc_page_report(_org_id uuid, _import_id uuid, _compare_import_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(page_url text, normalized_url text, clicks integer, impressions integer, ctr numeric, position_value numeric, mapped_community_id uuid, community_name text, mapped_content_type text, mapped_intent_type text, mapped_topic text, mapping_rule_id uuid, prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.page_url, c.normalized_url, c.clicks, c.impressions, c.ctr, c.position,
         c.mapped_community_id, com.name, c.mapped_content_type, c.mapped_intent_type,
         c.mapped_topic, c.mapping_rule_id,
         p.clicks, p.impressions, p.ctr, p.position
    FROM public.gsc_page_facts c
    JOIN public.gsc_imports ci
      ON ci.id = c.import_id AND ci.organization_id = _org_id AND ci.import_status <> 'failed'
    LEFT JOIN public.communities com ON com.id = c.mapped_community_id
    LEFT JOIN public.gsc_page_facts p
      ON _compare_import_id IS NOT NULL
     AND p.import_id = _compare_import_id
     AND p.organization_id = _org_id
     AND p.normalized_url = c.normalized_url
     AND EXISTS (SELECT 1 FROM public.gsc_imports pi
                  WHERE pi.id = _compare_import_id AND pi.organization_id = _org_id
                    AND pi.import_status <> 'failed')
   WHERE c.organization_id = _org_id AND c.import_id = _import_id;
$function$;

-- 3. Daily aggregates: active grains of successfully imported files only
CREATE OR REPLACE FUNCTION public.gsc_daily_totals(_org_id uuid, _start date, _end date)
 RETURNS TABLE(clicks bigint, impressions bigint, ctr numeric, avg_position numeric, days integer, first_date date, last_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(f.clicks),0)::bigint,
         COALESCE(SUM(f.impressions),0)::bigint,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END,
         COUNT(*)::integer,
         MIN(f.date), MAX(f.date)
    FROM public.gsc_daily_facts f
    JOIN public.gsc_import_grains g ON g.import_id = f.import_id AND g.grain = 'daily' AND g.is_active
    JOIN public.gsc_imports i ON i.id = f.import_id AND i.import_status = 'imported'
   WHERE f.organization_id = _org_id AND f.date BETWEEN _start AND _end;
$function$;

CREATE OR REPLACE FUNCTION public.gsc_daily_series(_org_id uuid, _start date, _end date)
 RETURNS TABLE(date date, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT f.date,
         SUM(f.clicks)::bigint,
         SUM(f.impressions)::bigint,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END
    FROM public.gsc_daily_facts f
    JOIN public.gsc_import_grains g ON g.import_id = f.import_id AND g.grain = 'daily' AND g.is_active
    JOIN public.gsc_imports i ON i.id = f.import_id AND i.import_status = 'imported'
   WHERE f.organization_id = _org_id AND f.date BETWEEN _start AND _end
   GROUP BY f.date ORDER BY f.date;
$function$;

-- 4. Per-import Dates-report totals (source-of-truth values for validation)
CREATE OR REPLACE FUNCTION public.gsc_import_daily_totals(_import_id uuid, _start date DEFAULT NULL, _end date DEFAULT NULL)
 RETURNS TABLE(clicks bigint, impressions bigint, ctr numeric, avg_position numeric, days integer, first_date date, last_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(f.clicks),0)::bigint,
         COALESCE(SUM(f.impressions),0)::bigint,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN COALESCE(SUM(f.impressions),0) > 0
              THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END,
         COUNT(*)::integer,
         MIN(f.date), MAX(f.date)
    FROM public.gsc_daily_facts f
   WHERE f.import_id = _import_id
     AND (_start IS NULL OR f.date >= _start)
     AND (_end IS NULL OR f.date <= _end);
$function$;

-- 5. Narrow, permission-checked completion of an import (lets marketing_user
--    finish an import without write access to connection configuration)
CREATE OR REPLACE FUNCTION public.gsc_complete_import(_import_id uuid, _metadata jsonb DEFAULT '{}'::jsonb, _through date DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  imp public.gsc_imports;
BEGIN
  SELECT * INTO imp FROM public.gsc_imports WHERE id = _import_id;
  IF imp.id IS NULL THEN
    RAISE EXCEPTION 'Import not found';
  END IF;
  IF NOT public.can_manage_imports(imp.organization_id) THEN
    RAISE EXCEPTION 'Not permitted to manage imports for this organization';
  END IF;

  UPDATE public.gsc_imports
     SET import_status = 'imported',
         metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(_metadata, '{}'::jsonb),
         error_summary = NULL
   WHERE id = _import_id;

  UPDATE public.data_source_connections c
     SET status = 'manual_upload',
         last_successful_sync_at = now(),
         last_attempted_sync_at = now(),
         data_through_date = GREATEST(COALESCE(_through, c.data_through_date), COALESCE(c.data_through_date, _through))
   WHERE c.id = imp.connection_id
     AND c.organization_id = imp.organization_id;
END; $function$;

REVOKE ALL ON FUNCTION public.gsc_complete_import(uuid, jsonb, date) FROM public;
GRANT EXECUTE ON FUNCTION public.gsc_complete_import(uuid, jsonb, date) TO authenticated;

-- 6. Failed-import cleanup: remove fact rows a failed import may have written
CREATE OR REPLACE FUNCTION public.gsc_discard_failed_import(_import_id uuid, _error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  imp public.gsc_imports;
BEGIN
  SELECT * INTO imp FROM public.gsc_imports WHERE id = _import_id;
  IF imp.id IS NULL THEN RETURN; END IF;
  IF NOT public.can_manage_imports(imp.organization_id) THEN
    RAISE EXCEPTION 'Not permitted to manage imports for this organization';
  END IF;

  DELETE FROM public.gsc_daily_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_query_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_page_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_device_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_country_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_search_appearance_facts WHERE import_id = _import_id;
  DELETE FROM public.gsc_import_grains WHERE import_id = _import_id;

  UPDATE public.gsc_imports
     SET import_status = 'failed', error_summary = _error
   WHERE id = _import_id;
END; $function$;

REVOKE ALL ON FUNCTION public.gsc_discard_failed_import(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.gsc_discard_failed_import(uuid, text) TO authenticated;