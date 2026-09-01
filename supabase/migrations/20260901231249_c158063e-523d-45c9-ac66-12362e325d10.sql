-- ============================================================
-- ClarityIQ Phase 1: Google Search Console ingestion
-- ============================================================

CREATE TYPE public.gsc_grain AS ENUM ('daily','query','page','device','country','search_appearance');
CREATE TYPE public.gsc_import_state AS ENUM ('pending','parsed','imported','failed','duplicate');
CREATE TYPE public.query_match_type AS ENUM ('exact_phrase','contains','starts_with','regex');
CREATE TYPE public.query_classification AS ENUM ('branded','local_intent','cost_intent','informational','care_type_intent','competitor','other');

-- Who may manage source imports: org admins and marketing users.
CREATE OR REPLACE FUNCTION public.can_manage_imports(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_admin(_org_id, _user_id)
      OR EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.organization_id = _org_id
                   AND m.role = 'marketing_user');
$$;

-- ------------------------------------------------------------
-- Imports
-- ------------------------------------------------------------
CREATE TABLE public.gsc_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_hash text NOT NULL,
  file_size_bytes bigint,
  imported_at timestamptz NOT NULL DEFAULT now(),
  data_start_date date,
  data_end_date date,
  import_status public.gsc_import_state NOT NULL DEFAULT 'pending',
  source_sync_run_id uuid REFERENCES public.source_sync_runs(id) ON DELETE SET NULL,
  created_by uuid,
  warnings text[] NOT NULL DEFAULT '{}',
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gsc_imports_hash_uniq ON public.gsc_imports (connection_id, file_hash)
  WHERE import_status <> 'failed';
CREATE INDEX gsc_imports_org_idx ON public.gsc_imports (organization_id, imported_at DESC);

-- Per report grain contained in an import. `is_active` implements the
-- overlap rule: the most recent import wins for an overlapping date range,
-- older imports are retained for audit but excluded from dashboards.
CREATE TABLE public.gsc_import_grains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.data_source_connections(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  grain public.gsc_grain NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  is_active boolean NOT NULL DEFAULT true,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, grain)
);
CREATE INDEX gsc_import_grains_lookup ON public.gsc_import_grains (organization_id, grain, is_active, period_start, period_end);

-- Deactivate older overlapping imports of the same grain on the same connection.
CREATE OR REPLACE FUNCTION public.gsc_supersede_overlapping_grains()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.gsc_import_grains g
     SET is_active = false
   WHERE g.connection_id = NEW.connection_id
     AND g.grain = NEW.grain
     AND g.id <> NEW.id
     AND g.is_active
     AND NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL
     AND g.period_start IS NOT NULL AND g.period_end IS NOT NULL
     AND g.period_start <= NEW.period_end
     AND g.period_end >= NEW.period_start;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_gsc_supersede AFTER INSERT ON public.gsc_import_grains
  FOR EACH ROW WHEN (NEW.is_active) EXECUTE FUNCTION public.gsc_supersede_overlapping_grains();

CREATE TRIGGER t_gsc_imports_touch BEFORE UPDATE ON public.gsc_imports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- Fact tables (one per export grain, never merged)
-- ------------------------------------------------------------
CREATE TABLE public.gsc_daily_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  date date NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, date)
);
CREATE INDEX gsc_daily_facts_idx ON public.gsc_daily_facts (organization_id, date);

CREATE TABLE public.gsc_query_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  query text NOT NULL,
  normalized_query text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, normalized_query)
);
CREATE INDEX gsc_query_facts_idx ON public.gsc_query_facts (organization_id, import_id, impressions DESC);
CREATE INDEX gsc_query_facts_norm_idx ON public.gsc_query_facts (normalized_query);

CREATE TABLE public.gsc_page_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  page_url text NOT NULL,
  normalized_url text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  mapped_community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  mapped_content_type text,
  mapped_intent_type text,
  mapped_topic text,
  mapped_care_type_id uuid REFERENCES public.care_types(id) ON DELETE SET NULL,
  mapping_rule_id uuid REFERENCES public.url_mapping_rules(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, normalized_url)
);
CREATE INDEX gsc_page_facts_idx ON public.gsc_page_facts (organization_id, import_id, impressions DESC);
CREATE INDEX gsc_page_facts_community_idx ON public.gsc_page_facts (mapped_community_id);
CREATE INDEX gsc_page_facts_content_idx ON public.gsc_page_facts (organization_id, mapped_content_type);

CREATE TABLE public.gsc_device_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  device text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, device)
);
CREATE INDEX gsc_device_facts_idx ON public.gsc_device_facts (organization_id, import_id);

CREATE TABLE public.gsc_country_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  country text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, country)
);
CREATE INDEX gsc_country_facts_idx ON public.gsc_country_facts (organization_id, import_id);

CREATE TABLE public.gsc_search_appearance_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.gsc_imports(id) ON DELETE CASCADE,
  search_appearance text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, search_appearance)
);
CREATE INDEX gsc_appearance_facts_idx ON public.gsc_search_appearance_facts (organization_id, import_id);

-- ------------------------------------------------------------
-- Query classification rules (per organization, deterministic)
-- ------------------------------------------------------------
CREATE TABLE public.gsc_query_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  match_type public.query_match_type NOT NULL DEFAULT 'contains',
  pattern text NOT NULL,
  classification public.query_classification NOT NULL,
  secondary_tags text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gsc_qcr_idx ON public.gsc_query_classification_rules (organization_id, active, priority);
CREATE TRIGGER t_gsc_qcr BEFORE UPDATE ON public.gsc_query_classification_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_import_grains TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_daily_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_page_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_device_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_country_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_search_appearance_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_classification_rules TO authenticated;
GRANT ALL ON public.gsc_imports TO service_role;
GRANT ALL ON public.gsc_import_grains TO service_role;
GRANT ALL ON public.gsc_daily_facts TO service_role;
GRANT ALL ON public.gsc_query_facts TO service_role;
GRANT ALL ON public.gsc_page_facts TO service_role;
GRANT ALL ON public.gsc_device_facts TO service_role;
GRANT ALL ON public.gsc_country_facts TO service_role;
GRANT ALL ON public.gsc_search_appearance_facts TO service_role;
GRANT ALL ON public.gsc_query_classification_rules TO service_role;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.gsc_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_import_grains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_daily_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_query_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_page_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_device_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_country_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_search_appearance_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_query_classification_rules ENABLE ROW LEVEL SECURITY;

-- Import metadata: any org member may read; only import managers may write.
CREATE POLICY "gsc_imports_read" ON public.gsc_imports FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));
CREATE POLICY "gsc_imports_write" ON public.gsc_imports FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_grains_read" ON public.gsc_import_grains FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));
CREATE POLICY "gsc_grains_write" ON public.gsc_import_grains FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

-- Property-level grains are organization-wide aggregates: only org-wide roles.
CREATE POLICY "gsc_daily_read" ON public.gsc_daily_facts FOR SELECT TO authenticated
  USING (public.has_org_wide_scope(organization_id));
CREATE POLICY "gsc_daily_write" ON public.gsc_daily_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_query_read" ON public.gsc_query_facts FOR SELECT TO authenticated
  USING (public.has_org_wide_scope(organization_id));
CREATE POLICY "gsc_query_write" ON public.gsc_query_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_device_read" ON public.gsc_device_facts FOR SELECT TO authenticated
  USING (public.has_org_wide_scope(organization_id));
CREATE POLICY "gsc_device_write" ON public.gsc_device_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_country_read" ON public.gsc_country_facts FOR SELECT TO authenticated
  USING (public.has_org_wide_scope(organization_id));
CREATE POLICY "gsc_country_write" ON public.gsc_country_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_appearance_read" ON public.gsc_search_appearance_facts FOR SELECT TO authenticated
  USING (public.has_org_wide_scope(organization_id));
CREATE POLICY "gsc_appearance_write" ON public.gsc_search_appearance_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

-- Page facts: org-wide roles see everything; scoped users only see pages
-- deterministically mapped to a community they may access.
CREATE POLICY "gsc_page_read" ON public.gsc_page_facts FOR SELECT TO authenticated
  USING (
    public.has_org_wide_scope(organization_id)
    OR (mapped_community_id IS NOT NULL AND public.has_community_access(mapped_community_id))
  );
CREATE POLICY "gsc_page_write" ON public.gsc_page_facts FOR ALL TO authenticated
  USING (public.can_manage_imports(organization_id))
  WITH CHECK (public.can_manage_imports(organization_id));

CREATE POLICY "gsc_rules_read" ON public.gsc_query_classification_rules FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));
CREATE POLICY "gsc_rules_write" ON public.gsc_query_classification_rules FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- ------------------------------------------------------------
-- Deterministic helpers
-- ------------------------------------------------------------

-- Applies existing url_mapping_rules to every page row of an import.
-- Highest priority (lowest number) matching active rule wins; no match means
-- the URL stays visibly unmapped.
CREATE OR REPLACE FUNCTION public.gsc_apply_page_mappings(_import_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE updated integer;
BEGIN
  WITH matched AS (
    SELECT f.id AS fact_id, r.id AS rule_id, r.community_id, r.content_type, r.intent_type, r.topic, r.care_type_id
      FROM public.gsc_page_facts f
      LEFT JOIN LATERAL (
        SELECT r.* FROM public.url_mapping_rules r
         WHERE r.organization_id = f.organization_id
           AND r.active
           AND (
             (r.match_type = 'exact_url'    AND f.normalized_url = r.pattern)
          OR (r.match_type = 'url_contains' AND position(lower(r.pattern) in lower(f.normalized_url)) > 0)
          OR (r.match_type = 'path_prefix'  AND lower(f.normalized_url) LIKE lower(r.pattern) || '%')
          OR (r.match_type = 'regex'        AND f.normalized_url ~* r.pattern)
           )
         ORDER BY r.priority ASC, r.created_at ASC
         LIMIT 1
      ) r ON true
     WHERE f.import_id = _import_id
  )
  UPDATE public.gsc_page_facts f
     SET mapping_rule_id = m.rule_id,
         mapped_community_id = m.community_id,
         mapped_content_type = m.content_type,
         mapped_intent_type = m.intent_type,
         mapped_topic = m.topic,
         mapped_care_type_id = m.care_type_id
    FROM matched m
   WHERE f.id = m.fact_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;

-- Deterministic query classification from organization rules.
CREATE OR REPLACE FUNCTION public.gsc_classify_query(_org_id uuid, _query text)
RETURNS public.query_classification LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT r.classification FROM public.gsc_query_classification_rules r
     WHERE r.organization_id = _org_id AND r.active
       AND (
         (r.match_type = 'exact_phrase' AND lower(_query) = lower(r.pattern))
      OR (r.match_type = 'contains'     AND position(lower(r.pattern) in lower(_query)) > 0)
      OR (r.match_type = 'starts_with'  AND lower(_query) LIKE lower(r.pattern) || '%')
      OR (r.match_type = 'regex'        AND _query ~* r.pattern)
       )
     ORDER BY r.priority ASC, r.created_at ASC
     LIMIT 1
  ), 'other'::public.query_classification);
$$;

-- Top-level totals from the DAILY report only. CTR is recomputed from summed
-- clicks/impressions; average position is impression-weighted. Query/page
-- exports are never summed into site totals (they are row limited and omit
-- anonymized queries).
CREATE OR REPLACE FUNCTION public.gsc_daily_totals(_org_id uuid, _start date, _end date)
RETURNS TABLE (clicks bigint, impressions bigint, ctr numeric, avg_position numeric, days integer,
               first_date date, last_date date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
   WHERE f.organization_id = _org_id AND f.date BETWEEN _start AND _end;
$$;

CREATE OR REPLACE FUNCTION public.gsc_daily_series(_org_id uuid, _start date, _end date)
RETURNS TABLE (date date, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT f.date,
         SUM(f.clicks)::bigint,
         SUM(f.impressions)::bigint,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.clicks)::numeric / SUM(f.impressions)::numeric END,
         CASE WHEN SUM(f.impressions) > 0 THEN SUM(f.position * f.impressions) / SUM(f.impressions)::numeric END
    FROM public.gsc_daily_facts f
    JOIN public.gsc_import_grains g ON g.import_id = f.import_id AND g.grain = 'daily' AND g.is_active
   WHERE f.organization_id = _org_id AND f.date BETWEEN _start AND _end
   GROUP BY f.date ORDER BY f.date;
$$;

-- Query report for one exported period, optionally compared to another export.
CREATE OR REPLACE FUNCTION public.gsc_query_report(_org_id uuid, _import_id uuid, _compare_import_id uuid DEFAULT NULL)
RETURNS TABLE (
  query text, normalized_query text, clicks integer, impressions integer, ctr numeric, position_value numeric,
  classification public.query_classification,
  prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.query, c.normalized_query, c.clicks, c.impressions, c.ctr, c.position,
         public.gsc_classify_query(_org_id, c.query),
         p.clicks, p.impressions, p.ctr, p.position
    FROM public.gsc_query_facts c
    LEFT JOIN public.gsc_query_facts p
      ON _compare_import_id IS NOT NULL
     AND p.import_id = _compare_import_id
     AND p.normalized_query = c.normalized_query
   WHERE c.organization_id = _org_id AND c.import_id = _import_id;
$$;

CREATE OR REPLACE FUNCTION public.gsc_page_report(_org_id uuid, _import_id uuid, _compare_import_id uuid DEFAULT NULL)
RETURNS TABLE (
  page_url text, normalized_url text, clicks integer, impressions integer, ctr numeric, position_value numeric,
  mapped_community_id uuid, community_name text, mapped_content_type text, mapped_intent_type text,
  mapped_topic text, mapping_rule_id uuid,
  prev_clicks integer, prev_impressions integer, prev_ctr numeric, prev_position_value numeric
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.page_url, c.normalized_url, c.clicks, c.impressions, c.ctr, c.position,
         c.mapped_community_id, com.name, c.mapped_content_type, c.mapped_intent_type,
         c.mapped_topic, c.mapping_rule_id,
         p.clicks, p.impressions, p.ctr, p.position
    FROM public.gsc_page_facts c
    LEFT JOIN public.communities com ON com.id = c.mapped_community_id
    LEFT JOIN public.gsc_page_facts p
      ON _compare_import_id IS NOT NULL
     AND p.import_id = _compare_import_id
     AND p.normalized_url = c.normalized_url
   WHERE c.organization_id = _org_id AND c.import_id = _import_id;
$$;

-- ------------------------------------------------------------
-- Metric registry: GSC definitions (versioned, provisional where classification dependent)
-- ------------------------------------------------------------
INSERT INTO public.metric_definitions
  (organization_id, metric_key, name, description, source_type, source_table, date_field,
   calculation_definition, exclusion_rules, supported_dimensions, metric_version, status, validation_status, effective_start)
VALUES
 (NULL,'gsc.clicks','Search Clicks','Total organic clicks from the Search Console Dates report. Query/Page exports are never summed into site totals.','google_search_console','gsc_daily_facts','date',
  '{"aggregation":"sum","field":"clicks","grain":"daily","active_imports_only":true}'::jsonb,'{"excludes":["superseded imports"]}'::jsonb,ARRAY['date'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.impressions','Search Impressions','Total organic impressions from the Search Console Dates report.','google_search_console','gsc_daily_facts','date',
  '{"aggregation":"sum","field":"impressions","grain":"daily","active_imports_only":true}'::jsonb,'{"excludes":["superseded imports"]}'::jsonb,ARRAY['date'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.ctr','Search CTR','Clicks divided by impressions over the aggregated period. Never an average of row CTR values.','google_search_console','gsc_daily_facts','date',
  '{"aggregation":"ratio","numerator":"clicks","denominator":"impressions","grain":"daily"}'::jsonb,'{}'::jsonb,ARRAY['date'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.avg_position','Average Position','Impression-weighted average position across daily rows.','google_search_console','gsc_daily_facts','date',
  '{"aggregation":"weighted_average","field":"position","weight":"impressions","grain":"daily"}'::jsonb,'{}'::jsonb,ARRAY['date'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.local_intent_clicks','Local Intent Clicks','Clicks from queries classified local_intent by organization classification rules. Limited to the query export grain.','google_search_console','gsc_query_facts',NULL,
  '{"aggregation":"sum","field":"clicks","grain":"query","filter":{"classification":"local_intent"}}'::jsonb,'{"notes":["Query exports omit anonymized queries and may be row limited"]}'::jsonb,ARRAY['query'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.branded_clicks','Branded Clicks','Clicks from queries classified branded by organization classification rules.','google_search_console','gsc_query_facts',NULL,
  '{"aggregation":"sum","field":"clicks","grain":"query","filter":{"classification":"branded"}}'::jsonb,'{"notes":["Requires configured branded rules"]}'::jsonb,ARRAY['query'],1,'provisional','unvalidated',CURRENT_DATE),
 (NULL,'gsc.informational_clicks','Informational Clicks','Clicks from queries classified informational by organization classification rules.','google_search_console','gsc_query_facts',NULL,
  '{"aggregation":"sum","field":"clicks","grain":"query","filter":{"classification":"informational"}}'::jsonb,'{"notes":["Requires configured informational rules"]}'::jsonb,ARRAY['query'],1,'provisional','unvalidated',CURRENT_DATE)
ON CONFLICT DO NOTHING;