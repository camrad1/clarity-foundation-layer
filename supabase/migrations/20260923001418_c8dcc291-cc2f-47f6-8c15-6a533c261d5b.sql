-- Separate data scope from administrative access.
-- Corporate User: org-wide data scope, no admin.
CREATE OR REPLACE FUNCTION public.has_org_wide_scope(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_platform_admin(_user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id
                       AND m.role IN ('organization_admin','corporate_user','marketing_user','read_only')));
$$;

-- System-level configuration is reserved for Super Admin.
CREATE OR REPLACE FUNCTION public.can_manage_system_config(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin(_user_id);
$$;
REVOKE ALL ON FUNCTION public.can_manage_system_config(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_system_config(uuid, uuid) TO authenticated, service_role;

-- Integrations, connections and imports: Super Admin plus the existing
-- marketing/import role. Corporate Admin is excluded.
CREATE OR REPLACE FUNCTION public.can_manage_imports(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_platform_admin(_user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id
                       AND m.role = 'marketing_user'));
$$;

-- Configuration tables move from org-admin to system-admin control.
DROP POLICY "mappings write" ON public.community_source_mappings;
CREATE POLICY "mappings write" ON public.community_source_mappings FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "connections write" ON public.data_source_connections;
CREATE POLICY "connections write" ON public.data_source_connections FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "gsc_rules_write" ON public.gsc_query_classification_rules;
CREATE POLICY "gsc_rules_write" ON public.gsc_query_classification_rules FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "metric defs org write" ON public.metric_definitions;
CREATE POLICY "metric defs org write" ON public.metric_definitions FOR ALL TO authenticated
USING (CASE WHEN organization_id IS NULL THEN public.is_platform_admin() ELSE public.can_manage_system_config(organization_id) END)
WITH CHECK (CASE WHEN organization_id IS NULL THEN public.is_platform_admin() ELSE public.can_manage_system_config(organization_id) END);

DROP POLICY "goals write" ON public.metric_goals;
CREATE POLICY "goals write" ON public.metric_goals FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "validation write" ON public.metric_validation_checks;
CREATE POLICY "validation write" ON public.metric_validation_checks FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "Mappings managed by org admins" ON public.occupancy_history_community_mappings;
CREATE POLICY "Mappings managed by system admins" ON public.occupancy_history_community_mappings FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

DROP POLICY "url rules write" ON public.url_mapping_rules;
CREATE POLICY "url rules write" ON public.url_mapping_rules FOR ALL TO authenticated
USING (public.can_manage_system_config(organization_id)) WITH CHECK (public.can_manage_system_config(organization_id));

-- Corporate Admin may manage peers (including other Corporate Admins) but
-- never Super Admin, and never their own membership row.
DROP POLICY "memberships insert" ON public.organization_memberships;
DROP POLICY "memberships update" ON public.organization_memberships;

CREATE POLICY "memberships insert" ON public.organization_memberships FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.is_org_admin(organization_id)
    AND role <> 'platform_admin'::public.app_role
    AND user_id <> auth.uid()
  )
);

CREATE POLICY "memberships update" ON public.organization_memberships FOR UPDATE TO authenticated
USING (
  public.is_platform_admin()
  OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
)
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.is_org_admin(organization_id)
    AND role <> 'platform_admin'::public.app_role
    AND user_id <> auth.uid()
  )
);
