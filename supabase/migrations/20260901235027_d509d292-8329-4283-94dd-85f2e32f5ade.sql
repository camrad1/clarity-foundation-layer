DROP TRIGGER IF EXISTS t_gsc_supersede ON public.gsc_import_grains;

CREATE TRIGGER t_gsc_supersede
AFTER INSERT OR UPDATE OF is_active ON public.gsc_import_grains
FOR EACH ROW
WHEN (NEW.is_active)
EXECUTE FUNCTION public.gsc_supersede_overlapping_grains();

CREATE OR REPLACE FUNCTION public.gsc_complete_import(_import_id uuid, _metadata jsonb DEFAULT '{}'::jsonb, _through date DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  imp public.gsc_imports;
BEGIN
  SELECT * INTO imp FROM public.gsc_imports WHERE id = _import_id;
  IF imp.id IS NULL THEN
    RAISE EXCEPTION 'Import not found';
  END IF;
  IF NOT public.can_manage_imports(imp.organization_id) THEN
    RAISE EXCEPTION 'Not permitted to manage imports for this organization';
  END IF;

  UPDATE public.gsc_imports
     SET import_status = 'imported',
         metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(_metadata, '{}'::jsonb),
         error_summary = NULL
   WHERE id = _import_id;

  -- Activation happens last: superseding of overlapping older grains is
  -- triggered only now that the new import is fully written.
  UPDATE public.gsc_import_grains
     SET is_active = true
   WHERE import_id = _import_id AND NOT is_active;

  UPDATE public.data_source_connections c
     SET status = 'manual_upload',
         last_successful_sync_at = now(),
         last_attempted_sync_at = now(),
         data_through_date = GREATEST(COALESCE(_through, c.data_through_date), COALESCE(c.data_through_date, _through))
   WHERE c.id = imp.connection_id
     AND c.organization_id = imp.organization_id;
END; $function$;