-- 1. Platform-admin privilege escalation protection -------------------------

DROP POLICY IF EXISTS "memberships write" ON public.organization_memberships;

CREATE POLICY "memberships insert" ON public.organization_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
  );

CREATE POLICY "memberships update" ON public.organization_memberships
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
  );

CREATE POLICY "memberships delete" ON public.organization_memberships
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
  );

-- Defence in depth: even a future permissive policy cannot mint platform admins.
CREATE OR REPLACE FUNCTION public.guard_platform_admin_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    -- service_role / server-side migrations run without a JWT.
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.role = 'platform_admin')
     OR (TG_OP = 'UPDATE' AND (NEW.role = 'platform_admin' OR OLD.role = 'platform_admin'))
     OR (TG_OP = 'DELETE' AND OLD.role = 'platform_admin') THEN
    IF NOT public.is_platform_admin(caller) THEN
      RAISE EXCEPTION 'Only a platform administrator may manage platform_admin membership';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS t_guard_platform_admin ON public.organization_memberships;
CREATE TRIGGER t_guard_platform_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_admin_grants();

REVOKE ALL ON FUNCTION public.guard_platform_admin_grants() FROM PUBLIC, anon;

-- 2. Profile visibility for organization administrators ----------------------

CREATE OR REPLACE FUNCTION public.can_admin_view_profile(_profile_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships target
        JOIN public.organization_memberships admin
          ON admin.organization_id = target.organization_id
        WHERE target.user_id = _profile_id
          AND admin.user_id = _user_id
          AND admin.role = 'organization_admin'::public.app_role
      );
$$;

REVOKE ALL ON FUNCTION public.can_admin_view_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_admin_view_profile(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "own profile select" ON public.profiles;
CREATE POLICY "profile select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.can_admin_view_profile(id));

-- 3. Initial metric registry definitions (provisional placeholders) ----------

UPDATE public.metric_definitions AS m
SET name = v.name,
    description = v.description,
    status = 'provisional'::public.metric_status,
    validation_status = 'unvalidated'::public.metric_validation_state
FROM (VALUES
  ('wh.new_inquiries','New Inquiries','Count of new prospect inquiries created in WelcomeHome for the period.'),
  ('wh.completed_tours','Completed Tours','Count of tours recorded as completed in WelcomeHome.'),
  ('wh.re_tours','Re-Tours','Completed tours for prospects who had already toured previously.'),
  ('wh.deposits','Deposits','Count of deposits recorded in WelcomeHome.'),
  ('wh.move_ins','Move-Ins','Count of move-ins recorded in WelcomeHome.'),
  ('wh.move_outs','Move-Outs','Count of move-outs recorded in WelcomeHome.'),
  ('wh.net_move_ins','Net Move-Ins','Move-ins less move-outs for the period.'),
  ('wh.occupancy_pct','Occupancy %','Occupied units as a percentage of available units.'),
  ('wh.projected_occupancy_pct','Projected Occupancy %','Occupancy percentage projected from known future move-ins and move-outs.'),
  ('wh.lead_to_tour','Lead to Tour Conversion','Share of new inquiries that reach a completed tour.'),
  ('wh.tour_to_deposit','Tour to Deposit Conversion','Share of completed tours that reach a deposit.'),
  ('wh.lead_to_movein','Lead to Move-In Conversion','Share of new inquiries that reach a move-in.'),
  ('wh.hot_leads','Hot Leads','Prospects currently flagged as hot in WelcomeHome.'),
  ('wh.hot_no_future_activity','Hot Leads Without Future Activity','Hot prospects with no scheduled future activity.'),
  ('wh.stalled_prospects','Stalled Prospects','Active prospects with no recent qualifying activity.'),
  ('gsc.clicks','Search Clicks','Clicks reported by Google Search Console for mapped properties.'),
  ('gsc.impressions','Search Impressions','Impressions reported by Google Search Console for mapped properties.'),
  ('gsc.ctr','Search CTR','Clicks divided by impressions for mapped properties.'),
  ('gsc.avg_position','Average Position','Impression-weighted average position reported by Google Search Console.'),
  ('gsc.local_intent_clicks','Local Intent Clicks','Clicks from queries classified as local intent.'),
  ('gsc.branded_clicks','Branded Clicks','Clicks from queries classified as branded.'),
  ('gsc.informational_clicks','Informational Clicks','Clicks from queries classified as informational.'),
  ('further.conversations','Further Conversations','Conversations recorded by Further for mapped communities.'),
  ('further.move_ins','Further Attributed Move-Ins','Move-ins attributed by Further.'),
  ('further.traffic_source_conversations','Conversations by Traffic Source','Further conversations broken down by traffic source.')
) AS v(metric_key, name, description)
WHERE m.metric_key = v.metric_key AND m.organization_id IS NULL;

INSERT INTO public.metric_definitions
  (organization_id, metric_key, name, description, source_type, calculation_definition,
   exclusion_rules, supported_dimensions, metric_version, status, validation_status, effective_start)
SELECT NULL, v.metric_key, v.name, v.description, v.source_type, '{}'::jsonb, '{}'::jsonb,
       ARRAY['community','care_type']::text[], 1,
       'provisional'::public.metric_status, 'unvalidated'::public.metric_validation_state, CURRENT_DATE
FROM (VALUES
  ('wh.new_inquiries','New Inquiries','Count of new prospect inquiries created in WelcomeHome for the period.','welcomehome'),
  ('wh.completed_tours','Completed Tours','Count of tours recorded as completed in WelcomeHome.','welcomehome'),
  ('wh.re_tours','Re-Tours','Completed tours for prospects who had already toured previously.','welcomehome'),
  ('wh.deposits','Deposits','Count of deposits recorded in WelcomeHome.','welcomehome'),
  ('wh.move_ins','Move-Ins','Count of move-ins recorded in WelcomeHome.','welcomehome'),
  ('wh.move_outs','Move-Outs','Count of move-outs recorded in WelcomeHome.','welcomehome'),
  ('wh.net_move_ins','Net Move-Ins','Move-ins less move-outs for the period.','welcomehome'),
  ('wh.occupancy_pct','Occupancy %','Occupied units as a percentage of available units.','welcomehome'),
  ('wh.projected_occupancy_pct','Projected Occupancy %','Occupancy percentage projected from known future move-ins and move-outs.','welcomehome'),
  ('wh.lead_to_tour','Lead to Tour Conversion','Share of new inquiries that reach a completed tour.','welcomehome'),
  ('wh.tour_to_deposit','Tour to Deposit Conversion','Share of completed tours that reach a deposit.','welcomehome'),
  ('wh.lead_to_movein','Lead to Move-In Conversion','Share of new inquiries that reach a move-in.','welcomehome'),
  ('wh.hot_leads','Hot Leads','Prospects currently flagged as hot in WelcomeHome.','welcomehome'),
  ('wh.hot_no_future_activity','Hot Leads Without Future Activity','Hot prospects with no scheduled future activity.','welcomehome'),
  ('wh.stalled_prospects','Stalled Prospects','Active prospects with no recent qualifying activity.','welcomehome'),
  ('gsc.clicks','Search Clicks','Clicks reported by Google Search Console for mapped properties.','search_console'),
  ('gsc.impressions','Search Impressions','Impressions reported by Google Search Console for mapped properties.','search_console'),
  ('gsc.ctr','Search CTR','Clicks divided by impressions for mapped properties.','search_console'),
  ('gsc.avg_position','Average Position','Impression-weighted average position reported by Google Search Console.','search_console'),
  ('gsc.local_intent_clicks','Local Intent Clicks','Clicks from queries classified as local intent.','search_console'),
  ('gsc.branded_clicks','Branded Clicks','Clicks from queries classified as branded.','search_console'),
  ('gsc.informational_clicks','Informational Clicks','Clicks from queries classified as informational.','search_console'),
  ('further.conversations','Further Conversations','Conversations recorded by Further for mapped communities.','further'),
  ('further.move_ins','Further Attributed Move-Ins','Move-ins attributed by Further.','further'),
  ('further.traffic_source_conversations','Conversations by Traffic Source','Further conversations broken down by traffic source.','further')
) AS v(metric_key, name, description, source_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.metric_definitions d
  WHERE d.metric_key = v.metric_key AND d.organization_id IS NULL
);
