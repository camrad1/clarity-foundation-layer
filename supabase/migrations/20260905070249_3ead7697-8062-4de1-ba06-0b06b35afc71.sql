-- Performance Journey read layer.
-- Reuses the existing canonical definitions (WelcomeHome settings + activity
-- mappings, Further active exact-ID matches, GA4 mapped landing pages,
-- Search Console API date grain). Nothing here redefines a metric.

CREATE OR REPLACE FUNCTION public.journey_community_matrix(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL)
RETURNS TABLE(community_id uuid, community_name text, sessions bigint, engaged_sessions bigint,
  further_leads bigint, further_matched bigint, inquiries bigint, tours bigint, re_tours bigint,
  deposits bigint, move_ins bigint, move_outs bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
WITH s AS (
  SELECT COALESCE(x.inquiry_date_field,'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field,'move_in_date') AS move_in_date_field,
         COALESCE(x.move_out_date_field,'move_out_date') AS move_out_date_field,
         COALESCE(x.exclude_merged_prospects,true) AS ex_merged,
         COALESCE(x.exclude_discarded_prospects,true) AS ex_disc
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id
),
scope AS (
  SELECT c.id, c.name, c.timezone FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_org_access(_org_id)
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR array_length(_community_ids,1) IS NULL OR c.id = ANY(_community_ids))
),
tids AS (SELECT array_agg(activity_type_id) AS ids FROM public.wh_activity_type_mappings
          WHERE organization_id = _org_id AND category = 'tour'),
okids AS (SELECT public.wh_successful_result_ids(_org_id) AS ids),
inq AS (
  SELECT pr.community_id AS cid, count(*)::bigint AS n
    FROM public.wh_prospects pr JOIN scope sc ON sc.id = pr.community_id CROSS JOIN s
   WHERE pr.organization_id = _org_id
     AND (NOT s.ex_merged OR pr.merged_into_prospect_id IS NULL)
     AND (NOT s.ex_disc OR pr.discarded_at IS NULL)
     AND ((CASE s.inquiry_date_field WHEN 'initial_contact_at' THEN pr.initial_contact_at
                                     WHEN 'active_at' THEN pr.active_at
                                     ELSE pr.created_at_source END)
          AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date BETWEEN _start AND _end
   GROUP BY 1
),
tr AS (
  SELECT ac.community_id AS cid, count(*)::bigint AS n,
         count(*) FILTER (WHERE ac.first_completed_of_type IS FALSE)::bigint AS rn
    FROM public.wh_activities ac JOIN scope sc ON sc.id = ac.community_id
    CROSS JOIN tids CROSS JOIN okids
   WHERE ac.organization_id = _org_id AND ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
     AND ac.completed_local_date BETWEEN _start AND _end
     AND tids.ids IS NOT NULL AND ac.activity_type_id = ANY(tids.ids)
     AND ac.result_id IS NOT NULL AND ac.result_id = ANY(okids.ids)
   GROUP BY 1
),
dep AS (
  SELECT cid, count(*)::bigint AS n FROM (
    SELECT DISTINCT dt.community_id AS cid,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS k
      FROM public.wh_deposit_transactions dt JOIN scope sc ON sc.id = dt.community_id
     WHERE dt.organization_id = _org_id AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit' AND dt.deposit_type = 'Deposit'
       AND dt.occurred_local_date BETWEEN _start AND _end AND COALESCE(dt.amount,0) > 0) q
  GROUP BY 1
),
mv AS (
  SELECT hc.community_id AS cid,
    count(*) FILTER (WHERE hc.count_move_in IS TRUE
      AND (CASE WHEN s.move_in_date_field='financial_move_in_date' THEN hc.financial_move_in_date
                ELSE hc.move_in_date END) BETWEEN _start AND _end)::bigint AS mi,
    count(*) FILTER (WHERE hc.count_move_out IS TRUE
      AND (CASE WHEN s.move_out_date_field='financial_move_out_date' THEN hc.financial_move_out_date
                ELSE hc.move_out_date END) BETWEEN _start AND _end)::bigint AS mo
    FROM public.wh_housing_contracts hc JOIN scope sc ON sc.id = hc.community_id CROSS JOIN s
   WHERE hc.organization_id = _org_id AND hc.lease_canceled_on IS NULL
   GROUP BY 1
),
fl AS (
  SELECT l.community_id AS cid, count(*)::bigint AS n,
         count(*) FILTER (WHERE m.id IS NOT NULL)::bigint AS matched
    FROM public.further_leads l JOIN scope sc ON sc.id = l.community_id
    LEFT JOIN public.further_wh_matches m
      ON m.organization_id = l.organization_id AND m.further_lead_id = l.further_lead_id AND m.is_active
   WHERE l.organization_id = _org_id
     AND (l.created_on AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date BETWEEN _start AND _end
   GROUP BY 1
),
ga AS (
  SELECT f.mapped_community_id AS cid, SUM(f.sessions)::bigint AS s,
         SUM(f.engaged_sessions)::bigint AS es
    FROM public.ga4_api_facts f JOIN scope sc ON sc.id = f.mapped_community_id
   WHERE f.organization_id = _org_id AND f.report = 'landing_page'
     AND f.date BETWEEN _start AND _end AND NOT COALESCE(f.is_partial_day,false)
   GROUP BY 1
)
SELECT sc.id, sc.name,
       COALESCE(ga.s,0), COALESCE(ga.es,0),
       COALESCE(fl.n,0), COALESCE(fl.matched,0),
       COALESCE(inq.n,0), COALESCE(tr.n,0), COALESCE(tr.rn,0),
       COALESCE(dep.n,0), COALESCE(mv.mi,0), COALESCE(mv.mo,0)
  FROM scope sc
  LEFT JOIN ga ON ga.cid = sc.id
  LEFT JOIN fl ON fl.cid = sc.id
  LEFT JOIN inq ON inq.cid = sc.id
  LEFT JOIN tr ON tr.cid = sc.id
  LEFT JOIN dep ON dep.cid = sc.id
  LEFT JOIN mv ON mv.cid = sc.id
 ORDER BY sc.name;
$fn$;

GRANT EXECUTE ON FUNCTION public.journey_community_matrix(uuid, date, date, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.journey_further_stage(
  _org_id uuid, _start date, _end date, _community_ids uuid[] DEFAULT NULL)
RETURNS TABLE(leads bigint, with_external_id bigint, matched bigint, conflicts bigint,
  tour_scheduled bigint, matched_toured bigint, matched_deposited bigint, matched_moved_in bigint,
  first_lead date, last_lead date, unmapped_leads bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
WITH scope AS (
  SELECT c.id, c.timezone FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_org_access(_org_id)
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR array_length(_community_ids,1) IS NULL OR c.id = ANY(_community_ids))
),
cohort AS (
  SELECT l.further_lead_id, l.external_lead_id, l.tour_scheduled, l.community_id,
         (l.created_on AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date AS d
    FROM public.further_leads l
    LEFT JOIN scope sc ON sc.id = l.community_id
   WHERE l.organization_id = _org_id
     AND (l.community_id IS NULL OR sc.id IS NOT NULL)
     AND (_community_ids IS NULL OR array_length(_community_ids,1) IS NULL OR l.community_id = ANY(_community_ids))
     AND (l.created_on AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date BETWEEN _start AND _end
),
m AS (
  SELECT c.further_lead_id, mm.wh_prospect_id
    FROM cohort c JOIN public.further_wh_matches mm
      ON mm.organization_id = _org_id AND mm.further_lead_id = c.further_lead_id AND mm.is_active
),
cf AS (
  SELECT count(*)::bigint AS n FROM cohort c JOIN public.further_wh_matches mm
    ON mm.organization_id = _org_id AND mm.further_lead_id = c.further_lead_id
   WHERE NOT mm.is_active
),
okids AS (SELECT public.wh_successful_result_ids(_org_id) AS ids),
tids AS (SELECT array_agg(activity_type_id) AS ids FROM public.wh_activity_type_mappings
          WHERE organization_id = _org_id AND category = 'tour')
SELECT (SELECT count(*)::bigint FROM cohort),
       (SELECT count(*)::bigint FROM cohort WHERE external_lead_id IS NOT NULL),
       (SELECT count(*)::bigint FROM m),
       (SELECT n FROM cf),
       (SELECT count(*)::bigint FROM cohort WHERE tour_scheduled IS TRUE),
       (SELECT count(DISTINCT m.wh_prospect_id)::bigint FROM m
          JOIN public.wh_activities ac ON ac.organization_id = _org_id
           AND ac.prospect_source_id = m.wh_prospect_id
          CROSS JOIN tids CROSS JOIN okids
         WHERE ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
           AND ac.completed_local_date <= _end
           AND tids.ids IS NOT NULL AND ac.activity_type_id = ANY(tids.ids)
           AND ac.result_id IS NOT NULL AND ac.result_id = ANY(okids.ids)),
       (SELECT count(DISTINCT m.wh_prospect_id)::bigint FROM m
          JOIN public.wh_deposit_transactions dt ON dt.organization_id = _org_id
           AND dt.prospect_source_id = m.wh_prospect_id
         WHERE dt.discarded_at IS NULL AND dt.transaction_type = 'Deposit'
           AND dt.deposit_type = 'Deposit' AND COALESCE(dt.amount,0) > 0
           AND dt.occurred_local_date <= _end),
       (SELECT count(DISTINCT m.wh_prospect_id)::bigint FROM m
          JOIN public.wh_housing_contracts hc ON hc.organization_id = _org_id
           AND hc.prospect_source_id = m.wh_prospect_id
         WHERE hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
           AND hc.move_in_date <= _end),
       (SELECT min(d) FROM cohort), (SELECT max(d) FROM cohort),
       (SELECT count(*)::bigint FROM cohort WHERE community_id IS NULL);
$fn$;

GRANT EXECUTE ON FUNCTION public.journey_further_stage(uuid, date, date, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.journey_stage_series(
  _org_id uuid, _start date, _end date, _grain text DEFAULT 'month', _community_ids uuid[] DEFAULT NULL)
RETURNS TABLE(bucket date, clicks bigint, impressions bigint, sessions bigint,
  further_leads bigint, inquiries bigint, tours bigint, deposits bigint, move_ins bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
WITH g AS (SELECT CASE WHEN _grain IN ('day','week','month') THEN _grain ELSE 'month' END AS grain),
s AS (
  SELECT COALESCE(x.inquiry_date_field,'created_at_source') AS inquiry_date_field,
         COALESCE(x.move_in_date_field,'move_in_date') AS move_in_date_field,
         COALESCE(x.exclude_merged_prospects,true) AS ex_merged,
         COALESCE(x.exclude_discarded_prospects,true) AS ex_disc
    FROM (SELECT 1) d LEFT JOIN public.wh_settings x ON x.organization_id = _org_id
),
scope AS (
  SELECT c.id, c.timezone FROM public.communities c
   WHERE c.organization_id = _org_id AND public.has_org_access(_org_id)
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL OR array_length(_community_ids,1) IS NULL OR c.id = ANY(_community_ids))
),
buckets AS (
  SELECT date_trunc((SELECT grain FROM g), dd)::date AS bucket
    FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') dd
   GROUP BY 1
),
b AS (SELECT bucket FROM buckets),
gsc AS (
  SELECT date_trunc((SELECT grain FROM g), f.date)::date AS bucket,
         SUM(f.clicks)::bigint AS clicks, SUM(f.impressions)::bigint AS impressions
    FROM public.gsc_api_facts f
   WHERE f.organization_id = _org_id AND f.grain = 'date' AND f.date BETWEEN _start AND _end
   GROUP BY 1
),
ga AS (
  SELECT date_trunc((SELECT grain FROM g), f.date)::date AS bucket, SUM(f.sessions)::bigint AS sessions
    FROM public.ga4_api_facts f
   WHERE f.organization_id = _org_id AND f.date BETWEEN _start AND _end
     AND NOT COALESCE(f.is_partial_day,false)
     AND (((_community_ids IS NULL OR array_length(_community_ids,1) IS NULL)
            AND f.report = 'daily_totals')
          OR (_community_ids IS NOT NULL AND array_length(_community_ids,1) > 0
            AND f.report = 'landing_page' AND f.mapped_community_id = ANY(_community_ids)))
   GROUP BY 1
),
fl AS (
  SELECT date_trunc((SELECT grain FROM g),
           (l.created_on AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date)::date AS bucket,
         count(*)::bigint AS n
    FROM public.further_leads l JOIN scope sc ON sc.id = l.community_id
   WHERE l.organization_id = _org_id
     AND (l.created_on AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date BETWEEN _start AND _end
   GROUP BY 1
),
inq AS (
  SELECT date_trunc((SELECT grain FROM g),
           ((CASE s.inquiry_date_field WHEN 'initial_contact_at' THEN pr.initial_contact_at
                                       WHEN 'active_at' THEN pr.active_at
                                       ELSE pr.created_at_source END)
            AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date)::date AS bucket,
         count(*)::bigint AS n
    FROM public.wh_prospects pr JOIN scope sc ON sc.id = pr.community_id CROSS JOIN s
   WHERE pr.organization_id = _org_id
     AND (NOT s.ex_merged OR pr.merged_into_prospect_id IS NULL)
     AND (NOT s.ex_disc OR pr.discarded_at IS NULL)
     AND ((CASE s.inquiry_date_field WHEN 'initial_contact_at' THEN pr.initial_contact_at
                                     WHEN 'active_at' THEN pr.active_at
                                     ELSE pr.created_at_source END)
          AT TIME ZONE COALESCE(sc.timezone,'UTC'))::date BETWEEN _start AND _end
   GROUP BY 1
),
tr AS (
  SELECT date_trunc((SELECT grain FROM g), ac.completed_local_date)::date AS bucket,
         count(*)::bigint AS n
    FROM public.wh_activities ac JOIN scope sc ON sc.id = ac.community_id
    CROSS JOIN (SELECT array_agg(activity_type_id) AS ids FROM public.wh_activity_type_mappings
                 WHERE organization_id = _org_id AND category = 'tour') tids
    CROSS JOIN (SELECT public.wh_successful_result_ids(_org_id) AS ids) okids
   WHERE ac.organization_id = _org_id AND ac.discarded_at IS NULL AND ac.completed_at IS NOT NULL
     AND ac.completed_local_date BETWEEN _start AND _end
     AND tids.ids IS NOT NULL AND ac.activity_type_id = ANY(tids.ids)
     AND ac.result_id IS NOT NULL AND ac.result_id = ANY(okids.ids)
   GROUP BY 1
),
dep AS (
  SELECT bucket, count(*)::bigint AS n FROM (
    SELECT DISTINCT date_trunc((SELECT grain FROM g), dt.occurred_local_date)::date AS bucket,
           dt.community_id,
           COALESCE(dt.prospect_source_id, dt.resident_source_id, dt.source_id) AS k
      FROM public.wh_deposit_transactions dt JOIN scope sc ON sc.id = dt.community_id
     WHERE dt.organization_id = _org_id AND dt.discarded_at IS NULL
       AND dt.transaction_type = 'Deposit' AND dt.deposit_type = 'Deposit'
       AND dt.occurred_local_date BETWEEN _start AND _end AND COALESCE(dt.amount,0) > 0) q
  GROUP BY 1
),
mv AS (
  SELECT date_trunc((SELECT grain FROM g),
           (CASE WHEN s.move_in_date_field='financial_move_in_date' THEN hc.financial_move_in_date
                 ELSE hc.move_in_date END))::date AS bucket,
         count(*)::bigint AS n
    FROM public.wh_housing_contracts hc JOIN scope sc ON sc.id = hc.community_id CROSS JOIN s
   WHERE hc.organization_id = _org_id AND hc.lease_canceled_on IS NULL AND hc.count_move_in IS TRUE
     AND (CASE WHEN s.move_in_date_field='financial_move_in_date' THEN hc.financial_move_in_date
               ELSE hc.move_in_date END) BETWEEN _start AND _end
   GROUP BY 1
)
SELECT b.bucket, COALESCE(gsc.clicks,0), COALESCE(gsc.impressions,0), COALESCE(ga.sessions,0),
       COALESCE(fl.n,0), COALESCE(inq.n,0), COALESCE(tr.n,0), COALESCE(dep.n,0), COALESCE(mv.n,0)
  FROM b
  LEFT JOIN gsc ON gsc.bucket = b.bucket
  LEFT JOIN ga ON ga.bucket = b.bucket
  LEFT JOIN fl ON fl.bucket = b.bucket
  LEFT JOIN inq ON inq.bucket = b.bucket
  LEFT JOIN tr ON tr.bucket = b.bucket
  LEFT JOIN dep ON dep.bucket = b.bucket
  LEFT JOIN mv ON mv.bucket = b.bucket
 ORDER BY b.bucket;
$fn$;

GRANT EXECUTE ON FUNCTION public.journey_stage_series(uuid, date, date, text, uuid[]) TO authenticated;