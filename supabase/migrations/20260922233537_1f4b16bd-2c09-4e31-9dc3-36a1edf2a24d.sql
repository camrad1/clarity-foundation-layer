ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles
   SET first_name = COALESCE(first_name, NULLIF(split_part(full_name, ' ', 1), '')),
       last_name = COALESCE(
         last_name,
         CASE WHEN position(' ' in COALESCE(full_name, '')) > 0
              THEN NULLIF(substr(full_name, position(' ' in full_name) + 1), '')
         END)
 WHERE full_name IS NOT NULL;

-- Deactivated accounts must lose data access at the database layer, not just in
-- the interface. A user with no profile row is treated as active so existing
-- accounts are never locked out by this change.
CREATE OR REPLACE FUNCTION public.is_user_active(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.is_active = false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND EXISTS (SELECT 1 FROM public.organization_memberships m
                 WHERE m.user_id = _user_id AND m.role = 'platform_admin');
$$;

CREATE OR REPLACE FUNCTION public.has_org_access(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_platform_admin(_user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id));
$$;

CREATE OR REPLACE FUNCTION public.has_org_wide_scope(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_platform_admin(_user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id
                       AND m.role IN ('organization_admin','marketing_user','read_only')));
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_platform_admin(_user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id
                       AND m.role = 'organization_admin'));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_imports(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND (public.is_org_admin(_org_id, _user_id)
          OR EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = _user_id AND m.organization_id = _org_id
                       AND m.role = 'marketing_user'));
$$;

CREATE OR REPLACE FUNCTION public.has_community_access(_community_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_user_active(_user_id)
     AND EXISTS (
    SELECT 1 FROM public.communities c
    WHERE c.id = _community_id
      AND (
        public.has_org_wide_scope(c.organization_id, _user_id)
        OR EXISTS (SELECT 1 FROM public.user_community_access a
                   WHERE a.user_id = _user_id AND a.community_id = c.id)
        OR (c.region_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_region_access r
              WHERE r.user_id = _user_id AND r.region_id = c.region_id))
      )
  );
$$;

-- Administrators may maintain the name and active flag of people in their own
-- organization. Platform admin profiles stay editable only by platform admins.
CREATE OR REPLACE FUNCTION public.can_admin_manage_profile(_profile_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (
        SELECT 1
          FROM public.organization_memberships target
          JOIN public.organization_memberships admin
            ON admin.organization_id = target.organization_id
         WHERE target.user_id = _profile_id
           AND admin.user_id = _user_id
           AND admin.role = 'organization_admin'::public.app_role
           AND target.role NOT IN ('platform_admin'::public.app_role, 'organization_admin'::public.app_role)
      );
$$;

DROP POLICY IF EXISTS "admin manage profile" ON public.profiles;
CREATE POLICY "admin manage profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.can_admin_manage_profile(id))
  WITH CHECK (public.can_admin_manage_profile(id));

-- Lockout safeguards.
CREATE OR REPLACE FUNCTION public.guard_profile_deactivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / migrations
  END IF;
  IF OLD.is_active AND NOT NEW.is_active THEN
    IF NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot deactivate your own account';
    END IF;
    IF EXISTS (SELECT 1 FROM public.organization_memberships m
                WHERE m.user_id = NEW.id AND m.role = 'platform_admin')
       AND NOT EXISTS (
         SELECT 1 FROM public.organization_memberships m
           JOIN public.profiles p ON p.id = m.user_id
          WHERE m.role = 'platform_admin' AND p.is_active AND p.id <> NEW.id) THEN
      RAISE EXCEPTION 'At least one active super administrator must remain';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_profile_deactivation ON public.profiles;
CREATE TRIGGER guard_profile_deactivation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_deactivation();

CREATE OR REPLACE FUNCTION public.guard_platform_admin_safety()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE losing boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    losing := OLD.role = 'platform_admin';
  ELSE
    losing := OLD.role = 'platform_admin' AND NEW.role <> 'platform_admin';
  END IF;
  IF losing THEN
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot remove your own super administrator access';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
        JOIN public.profiles p ON p.id = m.user_id
       WHERE m.role = 'platform_admin' AND p.is_active AND m.id <> OLD.id) THEN
      RAISE EXCEPTION 'At least one super administrator must remain';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS guard_platform_admin_safety ON public.organization_memberships;
CREATE TRIGGER guard_platform_admin_safety
  BEFORE UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_admin_safety();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NULLIF(trim(concat_ws(' ', NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name')), '')
    ),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.is_user_active(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_admin_manage_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_user_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_admin_manage_profile(uuid, uuid) TO authenticated, service_role;