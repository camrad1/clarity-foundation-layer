import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Reusable ClarityIQ chart primitives.
 *
 * Every chart here renders data that was aggregated server-side; none of them
 * derive KPI values in the browser. Colours come from the semantic chart tokens
 * in src/styles.css so light and dark themes stay consistent, and provisional
 * series are always drawn with the warning token rather than a trusted colour.
 *
 * Data labels follow one shared standard: raw count first, then the share of
 * the relevant denominator when that denominator is meaningful. Shares are a
 * display-only reshape of the already-aggregated values — no KPI is recomputed
 * in the browser.
 */

export const CHART_TOKENS = {
  primary: "var(--chart-1)",
  secondary: "var(--chart-2)",
  tertiary: "var(--chart-3)",
  quaternary: "var(--chart-4)",
  provisional: "var(--warning)",
  negative: "var(--chart-5)",
  muted: "var(--muted-foreground)",
} as const;

const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const LABEL_STYLE = {
  fill: "var(--muted-foreground)",
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
} as const;

/** Whole counts; thousands separated. */
export function fmtCount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString();
}

/** Whole-number percent by default; one decimal only when material (<10%). */
export function fmtPct(value: number, total: number): string | null {
  if (!total || !Number.isFinite(total) || total <= 0) return null;
  const pct = (value / total) * 100;
  if (!Number.isFinite(pct)) return null;
  if (pct > 0 && pct < 10) return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(pct)}%`;
}

function labelWithShare(value: number, total?: number | null): string {
  const pct = total != null ? fmtPct(value, total) : null;
  return pct ? `${fmtCount(value)} · ${pct}` : fmtCount(value);
}

function TooltipBox({
  active,
  payload,
  label,
  formatter,
  share,
  showTotal,
}: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p?.value != null);
  const total = rows.reduce((s: number, p: any) => s + Number(p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label ? <p className="mb-1 font-medium text-foreground">{label}</p> : null}
      {rows.map((p: any) => {
        const pct = share ? fmtPct(Number(p.value ?? 0), total) : null;
        return (
          <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: p.color ?? p.fill }} />
            <span className="text-foreground">{p.name}</span>
            <span className="ml-auto tabular-nums text-foreground">
              {formatter ? formatter(p.value) : fmtCount(Number(p.value))}
              {pct ? <span className="ml-1 text-muted-foreground">({pct})</span> : null}
            </span>
          </p>
        );
      })}
      {showTotal && rows.length > 1 ? (
        <p className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-muted-foreground">
          <span className="size-2" />
          <span className="text-foreground">Total</span>
          <span className="ml-auto tabular-nums font-medium text-foreground">{fmtCount(total)}</span>
        </p>
      ) : null}
    </div>
  );
}


export function ChartCard({
  title,
  description,
  badge,
  actions,
  loading,
  empty,
  height = 280,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  height?: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel space-y-4 p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {badge}
          </div>
          {description ? (
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {loading ? (
        <Skeleton className="w-full rounded-md" style={{ height }} />
      ) : empty ? (
        <div
          className="flex items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground"
          style={{ height }}
        >
          {empty}
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  );
}

export type TrendSeries = { key: string; label: string; color: string; dashed?: boolean };

/**
 * Multi-series monthly line chart. Data must already be one row per bucket.
 * Only the latest point of each series is labelled, so multi-series trends stay
 * readable; every point remains available in the tooltip.
 */
export function MetricTrendChart({
  data,
  series,
  xKey = "label",
  labelLatest = true,
}: {
  data: Record<string, any>[];
  series: TrendSeries[];
  xKey?: string;
  labelLatest?: boolean;
}) {
  const isMobile = useIsMobile();
  const lastIndex = data.length - 1;
  const showLabels = labelLatest && !isMobile && lastIndex >= 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 28, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={44} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--border)" }} />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            dot={false}
            activeDot={{ r: 4 }}
          >
            {showLabels ? (
              <LabelList
                dataKey={s.key}
                position="top"
                offset={8}
                style={{ ...LABEL_STYLE, fill: s.color }}
                formatter={(v: any) => (v == null ? "" : fmtCount(Number(v)))}
                content={(props: any) => {
                  if (props.index !== lastIndex) return null;
                  const v = props.value;
                  if (v == null || !Number.isFinite(Number(v))) return null;
                  return (
                    <text
                      x={Number(props.x) - 6}
                      y={Number(props.y) - 10}
                      textAnchor="end"
                      style={{ ...LABEL_STYLE, fill: s.color, fontWeight: 600 }}
                    >
                      {fmtCount(Number(v))}
                    </text>
                  );
                }}
              />
            ) : null}
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Grouped (or stacked) monthly bars with an optional overlay line.
 * Stacking is preferred when the bars are parts of one monthly total, such as
 * move-ins split by lead source. Stacked charts label the period total above
 * the stack; grouped charts label each bar's count.
 */
export function GroupedBarChart({
  data,
  bars,
  line,
  xKey = "label",
  stacked = false,
}: {
  data: Record<string, any>[];
  bars: TrendSeries[];
  line?: TrendSeries | undefined;
  xKey?: string;
  stacked?: boolean;
}) {
  const isMobile = useIsMobile();
  // Stacked charts draw one label per period, so only bucket count matters.
  const crowded = isMobile || (stacked ? data.length > 16 : data.length * Math.max(1, bars.length) > 26);
  const showLabels = !crowded;
  const totals = data.map((row) => bars.reduce((s, b) => s + Number(row[b.key] ?? 0), 0));
  const lastBarKey = bars.length ? bars[bars.length - 1]!.key : null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={44} />
        <Tooltip
          content={<TooltipBox share={stacked} showTotal={stacked} />}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
        />
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={b.color}
            {...(stacked ? { stackId: "stack" } : { radius: [3, 3, 0, 0] as [number, number, number, number] })}
            maxBarSize={stacked ? 34 : 22}
          >
            {showLabels && !stacked ? (
              <LabelList
                dataKey={b.key}
                position="top"
                offset={4}
                style={LABEL_STYLE}
                formatter={(v: any) => (Number(v) > 0 ? fmtCount(Number(v)) : "")}
              />
            ) : null}
            {showLabels && stacked && b.key === lastBarKey ? (
              <LabelList
                dataKey={b.key}
                position="top"
                offset={6}
                content={(props: any) => {
                  const total = totals[props.index] ?? 0;
                  if (!total) return null;
                  return (
                    <text
                      x={Number(props.x) + Number(props.width) / 2}
                      y={Number(props.y) - 6}
                      textAnchor="middle"
                      style={{ ...LABEL_STYLE, fill: "var(--foreground)", fontWeight: 600 }}
                    >
                      {fmtCount(total)}
                    </text>
                  );
                }}
              />
            ) : null}
          </Bar>
        ))}
        {line ? (
          <Line
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type BarDatum = { label: string; value: number; provisional?: boolean };

/**
 * Horizontal bars: preferred when exact comparison between categories matters.
 * Each bar is labelled with its raw count and, when the chart's values sum to a
 * meaningful whole (category breakdowns), its share of that total. Charts whose
 * values are already percentages pass showPercent={false}.
 */
export function HorizontalBarChart({
  data,
  color = CHART_TOKENS.primary,
  valueLabel = "Count",
  labelWidth = 150,
  showPercent = true,
}: {
  data: BarDatum[];
  color?: string | undefined;
  valueLabel?: string | undefined;
  labelWidth?: number | undefined;
  showPercent?: boolean | undefined;
}) {
  const isMobile = useIsMobile();
  const total = data.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const withPct = showPercent && !isMobile && total > 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: withPct ? 62 : 40, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          {...axisProps}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar dataKey="value" name={valueLabel} radius={[0, 3, 3, 0]} maxBarSize={18}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.provisional ? CHART_TOKENS.provisional : color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={6}
            style={LABEL_STYLE}
            formatter={(v: any) =>
              withPct ? labelWithShare(Number(v), total) : fmtCount(Number(v))
            }
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

}

export type FunnelStage = {
  label: string;
  value: number;
  provisional?: boolean;
  note?: string;
};

/**
 * Period-event funnel. Widths are relative to the first stage; the ratios shown
 * are stage-to-stage operational ratios, never cohort conversion rates.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const base = stages[0]?.value ?? 0;
  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const prev = i > 0 ? stages[i - 1]!.value : null;
        const width = base > 0 ? Math.max(6, (stage.value / base) * 100) : 6;
        const stepRatio = prev && prev > 0 ? (stage.value / prev) * 100 : null;
        return (
          <div key={stage.label} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-foreground">
                {stage.label}
                {stage.provisional ? (
                  <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    Provisional
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="font-display text-sm font-semibold tabular-nums text-foreground">
                  {stage.value.toLocaleString()}
                </span>
                {stepRatio != null ? <span className="ml-2">{stepRatio.toFixed(0)}% of previous stage</span> : null}
                {i > 1 && base > 0 ? (
                  <span className="ml-2">
                    {((stage.value / base) * 100).toFixed(0)}% of {stages[0]!.label.toLowerCase()}
                  </span>
                ) : null}
              </span>

            </div>
            <div className="h-8 w-full rounded-md bg-muted/60">
              <div
                className="h-8 rounded-md transition-all"
                style={{
                  width: `${width}%`,
                  background: stage.provisional ? CHART_TOKENS.provisional : CHART_TOKENS.primary,
                  opacity: stage.provisional ? 0.75 : 1 - i * 0.12,
                }}
              />
            </div>
            {stage.note ? <p className="text-[11px] text-muted-foreground">{stage.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Large percentage + progress bar. Accessible alternative to a gauge. */
export function ProgressGauge({
  value,
  total,
  display,
  caption,
}: {
  value: number;
  total: number;
  display: string;
  caption?: ReactNode;
}) {
  const pctVal = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <span className="font-display text-5xl font-semibold tracking-tight text-foreground">{display}</span>
        <span className="pb-2 text-sm text-muted-foreground">
          {value.toLocaleString()} occupied of {total.toLocaleString()} census-eligible units
        </span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={Math.round(pctVal)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Current occupancy"
      >
        <div className="h-3 rounded-full bg-primary" style={{ width: `${pctVal}%` }} />
      </div>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
