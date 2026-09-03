UPDATE public.communities
SET timezone = 'America/Los_Angeles'
WHERE timezone = 'America/Las_Vegas';

UPDATE public.organizations
SET default_timezone = 'America/Los_Angeles'
WHERE default_timezone = 'America/Las_Vegas';

CREATE OR REPLACE FUNCTION public.validate_timezone_value()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  IF TG_TABLE_NAME = 'communities' THEN
    v := NEW.timezone;
  ELSE
    v := NEW.default_timezone;
  END IF;

  IF v IS NULL OR btrim(v) = '' THEN
    RAISE EXCEPTION 'A reporting timezone is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v) THEN
    RAISE EXCEPTION 'Invalid timezone "%". Choose a supported IANA timezone.', v;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_community_timezone ON public.communities;
CREATE TRIGGER validate_community_timezone
BEFORE INSERT OR UPDATE OF timezone ON public.communities
FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_value();

DROP TRIGGER IF EXISTS validate_organization_timezone ON public.organizations;
CREATE TRIGGER validate_organization_timezone
BEFORE INSERT OR UPDATE OF default_timezone ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_value();