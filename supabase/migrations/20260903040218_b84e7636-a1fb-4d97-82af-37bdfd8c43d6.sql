
CREATE OR REPLACE FUNCTION public.wh_new_inquiries_monthly(
  _org_id uuid,
  _end date,
  _periods integer DEFAULT 12,
  _grain text DEFAULT 'month',
  _community_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(bucket date, inquiries integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scope uuid[];
  s record;
  p_start date;
  p_end date;
  g text;
BEGIN
  IF NOT public.has_org_access(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  g := CASE WHEN lower(COALESCE(_grain, 'month')) = 'week' THEN 'week' ELSE 'month' END;
  _end := COALESCE(_end, current_date);

  IF g = 'week' THEN
    _periods := least(greatest(COALESCE(_periods, 13), 1), 53);
    p_end := (public.flash_week_start(_end) + 6);
    p_start := public.flash_week_start(_end) - ((_periods - 1) * 7);
  ELSE
    _periods := least(greatest(COALESCE(_periods, 12), 1), 36);
    p_start := (date_trunc('month', _end)::date - make_interval(months => _periods - 1))::date;
    p_end := (date_trunc('month', _end)::date + interval '1 month - 1 day')::date;
  END IF;

  SELECT array_agg(c.id) INTO scope
    FROM public.communities c
   WHERE c.organization_id = _org_id
     AND public.has_community_access(c.id)
     AND (_community_ids IS NULL
          OR COALESCE(array_length(_community_ids, 1), 0) = 0
          OR c.id = ANY(_community_ids));
  scope := COALESCE(scope, ARRAY[]::uuid[]);

  SELECT COALESCE(x.inquiry_date_field, 'created_at_source') AS inquiry_date_field,
         COALESCE(x.exclude_merged_prospects, true) AS exclude_merged_prospects,
         COALESCE(x.exclude_discarded_prospects, true) AS exclude_discarded_prospects
    INTO s
    FROM (SELECT 1) d
    LEFT JOIN public.wh_settings x ON x.organization_id = _org_id;

  RETURN QUERY
  WITH buckets AS (
    SELECT generate_series(p_start, p_end, interval '7 day')::date AS b
     WHERE g = 'week'
    UNION ALL
    SELECT generate_series(p_start, date_trunc('month', p_end)::date, interval '1 month')::date
     WHERE g = 'month'
  ),
  pc AS (
    SELECT (CASE s.inquiry_date_field
              WHEN 'initial_contact_at' THEN pr.initial_contact_at
              WHEN 'active_at' THEN pr.active_at
              ELSE pr.created_at_source END
              AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS inq_local_date
      FROM public.wh_prospects pr
      LEFT JOIN public.communities c ON c.id = pr.community_id
     WHERE pr.organization_id = _org_id
       AND pr.community_id = ANY(scope)
       AND (NOT s.exclude_merged_prospects OR pr.merged_into_prospect_id IS NULL)
       AND (NOT s.exclude_discarded_prospects OR pr.discarded_at IS NULL)
  )
  SELECT buckets.b,
         (SELECT count(*)::int FROM pc
           WHERE CASE WHEN g = 'week'
                      THEN public.flash_week_start(pc.inq_local_date) = buckets.b
                      ELSE date_trunc('month', pc.inq_local_date)::date = buckets.b END)
    FROM buckets
   ORDER BY buckets.b;
END;
$function$;

REVOKE ALL ON FUNCTION public.wh_new_inquiries_monthly(uuid, date, integer, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_new_inquiries_monthly(uuid, date, integer, text, uuid[]) TO authenticated;
