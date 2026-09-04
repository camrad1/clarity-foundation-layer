# Show all point labels when hovering a series on occupancy trend charts

## What you asked for
On Sales Intelligence → Occupancy History ("Occupancy over time" and "Occupied units over time"), hovering a series name such as "Ending occupancy %" should reveal every value on that line — the numbers appear along the whole line, not just at the latest month.

## Current state (confirmed by reading the code)
- The shared `MetricTrendChart` (src/components/clarity/charts.tsx) already has a legend-focus feature: hovering/clicking a legend item emphasises one series and, in code, is meant to label all of its points.
- Two gaps prevent the behaviour you expect:
  1. The focus legend only activates when more than one series is visible (`multi = series.length > 1`). With a single visible series (e.g. after turning off the others via the chips) the plain legend renders and no focus/labels are possible.
  2. The "Ending occupancy %" labels you interact with on Sales Intelligence are the separate `SeriesToggleChips` above the chart — hovering them currently does nothing to the chart, so no labels appear.

## Plan (visualization-only)
1. In `src/components/clarity/charts.tsx`:
   - Remove the `multi`-only restriction so legend hover/focus works even with a single visible series (labels show for that series while hovered/focused).
   - Ensure the focused series labels every point with the chart's formatter (e.g. `94.2%`), styled in the series colour — this already exists via the active `LabelList`; verify it fires on hover, not only click.
2. In `src/components/clarity/sales-reports.tsx`:
   - Add an optional `onHoverSeries` callback to the series-toggle chips so hovering "Ending occupancy %" / "Beginning occupancy %" / "Budget occupancy %" (and the units chips) drives the same chart focus — every point on that line is labelled while hovered.
   - Plumb this through `MetricTrendChart` as an optional external `focusedKey` prop (default: internal state, so no other charts change).
3. Behaviour details:
   - Hover = temporary labels; leaving the name hides them again.
   - Click still locks focus (existing behaviour) with "Show all" to reset.
   - Dynamic/zoomed Y-axis, series toggles, daily/weekly controls, and the shared tooltip are unchanged.
   - Same improvement automatically applies to Occupancy Intelligence and any chart using the shared component.

## Guardrails
- No changes to occupancy data, calculations, snapshots, capacities, or the axis helper.
- Verify with typecheck and a browser hover test on Sales Intelligence (chart data permitting) and Occupancy Intelligence.
