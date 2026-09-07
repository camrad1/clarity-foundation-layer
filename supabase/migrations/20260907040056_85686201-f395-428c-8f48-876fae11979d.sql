CREATE OR REPLACE FUNCTION public.ga4_community_report(
  _org_id uuid, _start date, _end date,
  _community_ids uuid[] DEFAULT NULL, _include_partial boolean DEFAULT false)
RETURNS TABLE(community_id uuid, community_name text, sessions bigint, active_users bigint,
              new_users bigint, engaged_sessions bigint, screen_page_views bigint,
              engagement_rate numeric, landing_pages integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT f.mapped_community_id,
         c.name,
         COALESCE(SUM(f.sessions), 0)::bigint,
         COALESCE(SUM(f.active_users), 0)::bigint,
         COALESCE(SUM(f.new_users), 0)::bigint,
         COALESCE(SUM(f.engaged_sessions), 0)::bigint,
         COALESCE(SUM(f.screen_page_views), 0)::bigint,
         CASE WHEN COALESCE(SUM(f.sessions), 0) > 0
              THEN SUM(f.engaged_sessions)::numeric / SUM(f.sessions)::numeric END,
         COUNT(DISTINCT split_part(f.landing_page_path, '?', 1))::integer
    FROM public.ga4_api_facts f
    JOIN public.communities c ON c.id = f.mapped_community_id
   WHERE public.has_org_access(_org_id)
     AND f.organization_id = _org_id
     AND f.report = 'landing_page'
     AND f.mapped_community_id IS NOT NULL
     AND f.date BETWEEN _start AND _end
     AND (_include_partial OR NOT COALESCE(f.is_partial_day, false))
     AND (_community_ids IS NULL OR f.mapped_community_id = ANY(_community_ids))
   GROUP BY 1, 2
   ORDER BY 3 DESC;
$$;

REVOKE ALL ON FUNCTION public.ga4_community_report(uuid, date, date, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga4_community_report(uuid, date, date, uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_community_report(uuid, date, date, uuid[], boolean) TO service_role;