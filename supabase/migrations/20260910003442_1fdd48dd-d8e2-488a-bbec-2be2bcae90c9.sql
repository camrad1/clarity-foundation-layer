-- 1) further_leads: explicit deny of client writes (service role bypasses RLS)
CREATE POLICY "further_leads deny client writes"
ON public.further_leads
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

COMMENT ON TABLE public.further_leads IS
'Further lead PII. Read-only for org members; writes occur only via the trusted server-side Further sync (service role). Client INSERT/UPDATE/DELETE explicitly denied.';

-- 2) organization_memberships: prevent self-modification and org-admin self/peer elevation
DROP POLICY "memberships insert" ON public.organization_memberships;
DROP POLICY "memberships update" ON public.organization_memberships;

CREATE POLICY "memberships insert"
ON public.organization_memberships
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.is_org_admin(organization_id)
    AND role NOT IN ('platform_admin'::public.app_role, 'organization_admin'::public.app_role)
    AND user_id <> auth.uid()
  )
);

CREATE POLICY "memberships update"
ON public.organization_memberships
FOR UPDATE
TO authenticated
USING (
  public.is_platform_admin()
  OR (role <> 'platform_admin'::public.app_role AND public.is_org_admin(organization_id))
)
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.is_org_admin(organization_id)
    AND role NOT IN ('platform_admin'::public.app_role, 'organization_admin'::public.app_role)
    AND user_id <> auth.uid()
  )
);