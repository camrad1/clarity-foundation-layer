import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Reusable ClarityIQ chart primitives.
 *
 * Every chart here renders data that was aggregated server-side; none of them
 * derive KPI values in the browser. Colours come from the semantic chart tokens
 * in src/styles.css so light and dark themes stay consistent, and provisional
 * series are always drawn with the warning token rather than a trusted colour.
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

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label ? <p className="mb-1 font-medium text-foreground">{label}</p> : null}
      {payload.map((p: any) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          <span className="text-foreground">{p.name}</span>
          <span className="ml-auto tabular-nums text-foreground">
            {formatter ? formatter(p.value) : Number(p.value).toLocaleString()}
          </span>
        </p>
      ))}
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

/** Multi-series monthly line chart. Data must already be one row per bucket. */
export function MetricTrendChart({
  data,
  series,
  xKey = "label",
}: {
  data: Record<string, any>[];
  series: TrendSeries[];
  xKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
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
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Grouped monthly bars with an optional overlay line (e.g. net move-ins). */
export function GroupedBarChart({
  data,
  bars,
  line,
  xKey = "label",
}: {
  data: Record<string, any>[];
  bars: TrendSeries[];
  line?: TrendSeries | undefined;
  xKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={44} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Legend
          verticalAlign="bottom"
          height={28}
          wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
        />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color} radius={[3, 3, 0, 0]} maxBarSize={22} />
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

/** Horizontal bars: preferred when exact comparison between categories matters. */
export function HorizontalBarChart({
  data,
  color = CHART_TOKENS.primary,
  valueLabel = "Count",
  labelWidth = 150,
}: {
  data: BarDatum[];
  color?: string | undefined;
  valueLabel?: string | undefined;
  labelWidth?: number | undefined;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
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
