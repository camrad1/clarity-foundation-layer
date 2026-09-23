-- The previous restrictive FOR ALL policy also blocked SELECT, so in-app lead
-- counts read as zero. Restrict writes only; reads keep the existing
-- community-scoped permissive select policy.
DROP POLICY IF EXISTS "further_leads deny client writes" ON public.further_leads;

CREATE POLICY "further_leads deny client insert"
ON public.further_leads
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "further_leads deny client update"
ON public.further_leads
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "further_leads deny client delete"
ON public.further_leads
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (false);
