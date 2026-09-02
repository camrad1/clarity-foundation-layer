-- Phase 1 correction: fix canonical source key and replace placeholder definitions
-- for the seven GSC metric definitions. These records are still
-- provisional/unvalidated, so update in place (no new versions, no duplicates).

-- gsc.clicks
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_daily_facts',
  date_field = 'date',
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Sum of clicks from active, successfully imported Dates-report grains',
    'source', jsonb_build_object(
      'table', 'gsc_daily_facts',
      'join', 'gsc_import_grains on import_id and grain = ''daily'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'aggregation', jsonb_build_object('type', 'sum', 'column', 'clicks')
  ),
  updated_at = now()
WHERE metric_key = 'gsc.clicks' AND status = 'provisional';

-- gsc.impressions
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_daily_facts',
  date_field = 'date',
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Sum of impressions from active, successfully imported Dates-report grains',
    'source', jsonb_build_object(
      'table', 'gsc_daily_facts',
      'join', 'gsc_import_grains on import_id and grain = ''daily'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'aggregation', jsonb_build_object('type', 'sum', 'column', 'impressions')
  ),
  updated_at = now()
WHERE metric_key = 'gsc.impressions' AND status = 'provisional';

-- gsc.ctr — aggregated clicks / aggregated impressions, never an average of row CTRs
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_daily_facts',
  date_field = 'date',
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Aggregated clicks divided by aggregated impressions; row-level CTR values are never averaged',
    'source', jsonb_build_object(
      'table', 'gsc_daily_facts',
      'join', 'gsc_import_grains on import_id and grain = ''daily'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'aggregation', jsonb_build_object(
      'type', 'ratio',
      'numerator', jsonb_build_object('type', 'sum', 'column', 'clicks'),
      'denominator', jsonb_build_object('type', 'sum', 'column', 'impressions'),
      'null_if_zero_denominator', true
    )
  ),
  updated_at = now()
WHERE metric_key = 'gsc.ctr' AND status = 'provisional';

-- gsc.avg_position — impression-weighted average position
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_daily_facts',
  date_field = 'date',
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Impression-weighted average position across active, successfully imported Dates-report grains',
    'source', jsonb_build_object(
      'table', 'gsc_daily_facts',
      'join', 'gsc_import_grains on import_id and grain = ''daily'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'aggregation', jsonb_build_object(
      'type', 'weighted_avg',
      'value_column', 'position',
      'weight_column', 'impressions'
    )
  ),
  updated_at = now()
WHERE metric_key = 'gsc.avg_position' AND status = 'provisional';

-- Classification-dependent metrics: query facts + deterministic rule-based classification

-- gsc.branded_clicks
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_query_facts',
  date_field = NULL,
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Sum of clicks for queries classified as branded by gsc_classify_query (deterministic rule-based classification)',
    'source', jsonb_build_object(
      'table', 'gsc_query_facts',
      'join', 'gsc_import_grains on import_id and grain = ''query'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'classification', jsonb_build_object(
      'function', 'gsc_classify_query',
      'equals', 'branded',
      'fallback', 'unclassified'
    ),
    'aggregation', jsonb_build_object('type', 'sum', 'column', 'clicks')
  ),
  updated_at = now()
WHERE metric_key = 'gsc.branded_clicks' AND status = 'provisional';

-- gsc.local_intent_clicks
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_query_facts',
  date_field = NULL,
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Sum of clicks for queries classified as local_intent by gsc_classify_query (deterministic rule-based classification)',
    'source', jsonb_build_object(
      'table', 'gsc_query_facts',
      'join', 'gsc_import_grains on import_id and grain = ''query'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'classification', jsonb_build_object(
      'function', 'gsc_classify_query',
      'equals', 'local_intent',
      'fallback', 'unclassified'
    ),
    'aggregation', jsonb_build_object('type', 'sum', 'column', 'clicks')
  ),
  updated_at = now()
WHERE metric_key = 'gsc.local_intent_clicks' AND status = 'provisional';

-- gsc.informational_clicks
UPDATE public.metric_definitions
SET
  source_type = 'search_console',
  source_table = 'gsc_query_facts',
  date_field = NULL,
  calculation_definition = jsonb_build_object(
    'engine', 'sql',
    'description', 'Sum of clicks for queries classified as informational by gsc_classify_query (deterministic rule-based classification)',
    'source', jsonb_build_object(
      'table', 'gsc_query_facts',
      'join', 'gsc_import_grains on import_id and grain = ''query'' and is_active',
      'filters', jsonb_build_object('import_status', 'imported')
    ),
    'classification', jsonb_build_object(
      'function', 'gsc_classify_query',
      'equals', 'informational',
      'fallback', 'unclassified'
    ),
    'aggregation', jsonb_build_object('type', 'sum', 'column', 'clicks')
  ),
  updated_at = now()
WHERE metric_key = 'gsc.informational_clicks' AND status = 'provisional';