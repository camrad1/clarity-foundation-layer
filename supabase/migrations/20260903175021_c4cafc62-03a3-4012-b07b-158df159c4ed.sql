DELETE FROM public.forecast_weekly_entries
 WHERE source_type = 'manual' AND forecast_date = DATE '2026-09-28'
   AND projected_move_ins = 6 AND projected_move_outs = 3;