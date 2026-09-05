ALTER TABLE public.ga4_api_facts DROP CONSTRAINT IF EXISTS ga4_api_facts_report_check;
ALTER TABLE public.ga4_api_facts ADD CONSTRAINT ga4_api_facts_report_check CHECK (report = ANY (ARRAY['daily_totals','source_medium','landing_page','channel_group','device','source_medium_campaign']));

ALTER TABLE public.ga4_api_facts
  ADD COLUMN IF NOT EXISTS session_source text,
  ADD COLUMN IF NOT EXISTS session_medium text,
  ADD COLUMN IF NOT EXISTS session_campaign text,
  ADD COLUMN IF NOT EXISTS default_channel_group text,
  ADD COLUMN IF NOT EXISTS device_category text,
  ADD COLUMN IF NOT EXISTS engagement_rate numeric,
  ADD COLUMN IF NOT EXISTS is_partial_day boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ga4_api_facts_report_date_idx ON public.ga4_api_facts (organization_id, property_id, report, date);
CREATE INDEX IF NOT EXISTS ga4_api_facts_landing_idx ON public.ga4_api_facts (organization_id, report, landing_page_path) WHERE landing_page_path IS NOT NULL;