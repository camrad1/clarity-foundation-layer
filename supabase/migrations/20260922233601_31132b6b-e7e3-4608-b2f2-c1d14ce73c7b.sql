REVOKE ALL ON FUNCTION public.guard_profile_deactivation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_platform_admin_safety() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_deactivation() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_platform_admin_safety() TO service_role;