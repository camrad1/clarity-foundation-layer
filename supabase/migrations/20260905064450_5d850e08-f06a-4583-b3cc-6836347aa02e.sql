-- Harmless string/integer normalization only: trim, and collapse numeric strings
-- to a canonical numeric form (so "0123" and "123" are the same ID). No fuzzy logic.
CREATE OR REPLACE FUNCTION public.further_norm_id(_v text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _v IS NULL OR btrim(_v) = '' THEN NULL
    WHEN btrim(_v) ~ '^[0-9]+$' THEN (btrim(_v))::numeric::text
    ELSE btrim(_v)
  END;
$$;

/**
 * Deterministic activation of Further -> WelcomeHome matches.
 *
 * Active canonical match requires ALL of:
 *   - external_lead_id present
 *   - exactly one WelcomeHome prospect with that source_id
 *   - the external_lead_id is not shared by multiple Further leads
 *   - the Further lead's canonical community equals the prospect's community
 *
 * Everything else is stored as conflict / needs_review and never activated.
 * The routine fully rebuilds exact-ID evidence so it is idempotent.
 */
CREATE OR REPLACE FUNCTION public.further_activate_matches(_org_id uuid)
RETURNS TABLE(active integer, conflicts integer, needs_review integer, unmatched integer, examined integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _now timestamptz := now();
BEGIN
  CREATE TEMP TABLE _fl ON COMMIT DROP AS
  SELECT l.further_lead_id::text AS further_lead_id,
         l.external_lead_id::text AS external_lead_id,
         public.further_norm_id(l.external_lead_id::text) AS key,
         l.community_id AS further_community_id,
         l.created_on
    FROM public.further_leads l
   WHERE l.organization_id = _org_id
     AND public.further_norm_id(l.external_lead_id::text) IS NOT NULL;

  CREATE TEMP TABLE _wp ON COMMIT DROP AS
  SELECT public.further_norm_id(p.source_id) AS key,
         min(p.source_id) AS source_id,
         min(p.community_id::text)::uuid AS community_id,
         count(*)::int AS prospect_count
    FROM public.wh_prospects p
   WHERE p.organization_id = _org_id
   GROUP BY 1;

  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT f.*,
         w.source_id AS wh_prospect_id,
         w.community_id AS wh_community_id,
         w.prospect_count,
         count(*) OVER (PARTITION BY f.key) AS lead_dupes
    FROM _fl f
    LEFT JOIN _wp w ON w.key = f.key;

  -- Rebuild exact-ID evidence for this organization only.
  DELETE FROM public.further_wh_matches
   WHERE organization_id = _org_id
     AND evidence_type IN ('exact_external_id', 'exact_external_id_conflict');

  INSERT INTO public.further_wh_matches (
    organization_id, further_lead_id, further_external_lead_id, wh_prospect_id,
    wh_field, community_id, match_method, evidence_type, is_active, matched_at, audit)
  SELECT _org_id,
         c.further_lead_id,
         c.external_lead_id,
         c.wh_prospect_id,
         'source_id',
         COALESCE(c.wh_community_id, c.further_community_id),
         'exact_external_id',
         CASE WHEN st = 'active' THEN 'exact_external_id' ELSE 'exact_external_id_conflict' END,
         st = 'active',
         CASE WHEN st = 'active' THEN _now END,
         jsonb_build_object(
           'state', st,
           'reason', reason,
           'normalized_key', c.key,
           'further_community_id', c.further_community_id,
           'wh_community_id', c.wh_community_id,
           'wh_prospects_with_key', COALESCE(c.prospect_count, 0),
           'further_leads_with_key', c.lead_dupes,
           'source', 'further_activate_matches',
           'evaluated_at', _now)
    FROM (
      SELECT c.*,
             CASE
               WHEN c.wh_prospect_id IS NULL THEN 'unmatched'
               WHEN c.lead_dupes > 1 THEN 'conflict'
               WHEN c.prospect_count > 1 THEN 'conflict'
               WHEN c.further_community_id IS NULL OR c.wh_community_id IS NULL THEN 'needs_review'
               WHEN c.further_community_id <> c.wh_community_id THEN 'needs_review'
               ELSE 'active'
             END AS st,
             CASE
               WHEN c.wh_prospect_id IS NULL THEN 'no WelcomeHome prospect with this source_id'
               WHEN c.lead_dupes > 1 THEN 'external_lead_id appears on multiple Further leads'
               WHEN c.prospect_count > 1 THEN 'multiple WelcomeHome prospects share this source_id'
               WHEN c.further_community_id IS NULL THEN 'Further lead has no canonical community mapping'
               WHEN c.wh_community_id IS NULL THEN 'WelcomeHome prospect has no canonical community'
               WHEN c.further_community_id <> c.wh_community_id THEN 'community mapping conflict'
               ELSE 'exact single-ID match with agreeing community'
             END AS reason
        FROM _cand c
    ) c
   WHERE st <> 'unmatched';

  RETURN QUERY
  SELECT count(*) FILTER (WHERE st = 'active')::int,
         count(*) FILTER (WHERE st = 'conflict')::int,
         count(*) FILTER (WHERE st = 'needs_review')::int,
         count(*) FILTER (WHERE st = 'unmatched')::int,
         count(*)::int
    FROM (
      SELECT CASE
               WHEN c.wh_prospect_id IS NULL THEN 'unmatched'
               WHEN c.lead_dupes > 1 OR c.prospect_count > 1 THEN 'conflict'
               WHEN c.further_community_id IS NULL OR c.wh_community_id IS NULL
                 OR c.further_community_id <> c.wh_community_id THEN 'needs_review'
               ELSE 'active'
             END AS st
        FROM _cand c
    ) s;
END;
$$;

/** Read-only match coverage, overall and by lead year. */
CREATE OR REPLACE FUNCTION public.further_match_coverage(_org_id uuid)
RETURNS TABLE(bucket text, leads bigint, with_external_id bigint, active bigint,
              conflicts bigint, needs_review bigint, unmatched bigint, match_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT l.further_lead_id::text AS lead_id,
           to_char(l.created_on, 'YYYY') AS yr,
           (public.further_norm_id(l.external_lead_id::text) IS NOT NULL) AS has_ext,
           m.evidence_type,
           m.is_active
      FROM public.further_leads l
      LEFT JOIN public.further_wh_matches m
        ON m.organization_id = l.organization_id
       AND m.further_lead_id = l.further_lead_id::text
       AND m.evidence_type IN ('exact_external_id', 'exact_external_id_conflict')
     WHERE l.organization_id = _org_id
       AND public.has_org_access(_org_id)
  ), agg AS (
    SELECT bucket, count(*) AS leads,
           count(*) FILTER (WHERE has_ext) AS with_external_id,
           count(*) FILTER (WHERE is_active) AS active,
           count(*) FILTER (WHERE evidence_type = 'exact_external_id_conflict') AS flagged,
           count(*) FILTER (WHERE has_ext AND evidence_type IS NULL) AS unmatched
      FROM (SELECT b.*, 'all' AS bucket FROM base b
            UNION ALL
            SELECT b.*, COALESCE(b.yr, 'unknown') AS bucket FROM base b) x
     GROUP BY bucket
  )
  SELECT bucket, leads, with_external_id, active,
         flagged AS conflicts, 0::bigint AS needs_review, unmatched,
         CASE WHEN with_external_id > 0
              THEN round(active::numeric / with_external_id::numeric, 4) END
    FROM agg
   ORDER BY (bucket = 'all') DESC, bucket DESC;
$$;

GRANT EXECUTE ON FUNCTION public.further_match_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.further_norm_id(text) TO authenticated;