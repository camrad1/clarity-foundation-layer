DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- Re-grant execute to signed-in users only for the routines the app calls,
-- every one of which verifies organization/community access internally.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        'can_admin_view_profile','can_manage_imports','forecast_eom_actuals','further_match_coverage',
        'ga4_coverage','ga4_daily_series','ga4_daily_totals','ga4_dimension_report','ga4_health','ga4_landing_page_report',
        'gsc_api_coverage','gsc_api_daily_series','gsc_api_daily_totals','gsc_api_dimension_report','gsc_api_page_report',
        'gsc_api_query_page_report','gsc_api_query_report','gsc_complete_import','gsc_discard_failed_import',
        'has_community_access','has_org_access','has_org_wide_scope','is_org_admin','is_platform_admin',
        'journey_community_matrix','journey_further_stage','journey_stage_series','occ_history_health',
        'wh_activity_mix','wh_conversion_rates','wh_conversion_series','wh_current_occupancy','wh_data_completeness',
        'wh_deposit_page','wh_flash_deposits','wh_flash_hot_leads','wh_flash_move_ins','wh_flash_move_outs',
        'wh_flash_notices','wh_flash_report','wh_lookup_coverage','wh_lost_lead_summary','wh_move_in_page',
        'wh_move_ins_by_lead_source_monthly','wh_move_out_reason_summary','wh_new_inquiries_monthly',
        'wh_occupancy_monthly_history','wh_occupancy_trend','wh_prospect_page','wh_sales_summary','wh_sales_trend',
        'wh_snapshot_health','wh_tour_page','wh_unit_census_report'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- Server-side/admin paths continue to run under the service role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;