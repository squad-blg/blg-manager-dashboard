import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { ClientSummary } from "@/pages/Dashboard";

interface Props {
  clients: ClientSummary[];
}

const COLOR_PRIMARY = "hsl(93, 48%, 55%)";
const COLOR_PRIOR = "hsl(93, 48%, 55%, 0.35)"; // faded for prior year line
const CHART_COLORS = [
  "hsl(93, 48%, 55%)",
  "hsl(160, 55%, 42%)",
  "hsl(37, 91%, 55%)",
  "hsl(280, 50%, 60%)",
  "hsl(340, 65%, 55%)",
  "hsl(120, 40%, 45%)",
];

type ChartMode = "combined" | "breakdown";
type ChartType = "area" | "bar";

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function shortMonth(period: string) {
  const [y, m] = period.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short" });
}

export default function RevenueChart({ clients }: Props) {
  const [mode, setMode] = useState<ChartMode>("combined");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [showYoy, setShowYoy] = useState(true);

  // ── Combined dataset: aggregate ad spend + prior-year overlay ──────────────
  const combinedData = useMemo(() => {
    if (!clients.length) return [];

    // Collect all periods from ads.history
    const periodSet = new Set<string>();
    clients.forEach((c) => c.ads.history.forEach((h) => periodSet.add(h.period)));
    const periods = Array.from(periodSet).sort().slice(-13);

    return periods.map((period) => {
      let totalSpend = 0;
      let totalPrior = 0;
      let hasPrior = false;

      clients.forEach((c) => {
        const h = c.ads.history.find((x) => x.period === period);
        if (h) {
          totalSpend += h.adSpend ?? 0;
          if (h.adSpendPriorYear != null) {
            totalPrior += h.adSpendPriorYear;
            hasPrior = true;
          }
        }
      });

      return {
        period,
        label: shortMonth(period),
        adSpend: Math.round(totalSpend),
        adSpendPriorYear: hasPrior ? Math.round(totalPrior) : null,
      };
    });
  }, [clients]);

  // ── Per-client breakdown ───────────────────────────────────────────────────
  const breakdownData = useMemo(() => {
    if (!clients.length) return { data: [], keys: [] };

    const periodSet = new Set<string>();
    clients.forEach((c) => c.ads.history.forEach((h) => periodSet.add(h.period)));
    const periods = Array.from(periodSet).sort().slice(-13);

    const data = periods.map((period) => {
      const row: Record<string, any> = { period, label: shortMonth(period) };
      clients.forEach((c) => {
        const h = c.ads.history.find((x) => x.period === period);
        row[c.client.name] = Math.round(h?.adSpend ?? 0);
      });
      return row;
    });

    return { data, keys: clients.map((c) => c.client.name) };
  }, [clients]);

  const tooltipStyle = {
    background: "hsl(150,16%,10%)",
    border: "1px solid hsl(150,12%,17%)",
    borderRadius: "6px",
    color: "hsl(140,15%,90%)",
    fontSize: "12px",
  };

  const axisTickStyle = { fill: "hsl(140,8%,52%)", fontSize: 11 };

  const yFmt = (v: number) => formatCurrency(v);
  const tooltipFmt = (v: number, name: string) => [formatCurrency(v), name];

  return (
    <Card className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Ad Spend Trend — Last 12 Months
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "combined"
              ? showYoy
                ? "Current year vs same month prior year"
                : "Aggregated across selected clients"
              : "Per-client ad spend"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* YoY toggle — only in combined mode */}
          {mode === "combined" && (
            <button
              data-testid="chart-yoy-toggle"
              onClick={() => setShowYoy((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                showYoy
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              YoY overlay
            </button>
          )}

          {/* Mode toggle */}
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
              data-testid="chart-mode-combined"
              onClick={() => setMode("combined")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "combined"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Combined
            </button>
            <button
              data-testid="chart-mode-breakdown"
              onClick={() => setMode("breakdown")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "breakdown"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              By Client
            </button>
          </div>

          {/* Chart type */}
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
              data-testid="chart-type-area"
              onClick={() => setChartType("area")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                chartType === "area"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Area
            </button>
            <button
              data-testid="chart-type-bar"
              onClick={() => setChartType("bar")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                chartType === "bar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Bar
            </button>
          </div>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "combined" ? (
            chartType === "area" ? (
              <AreaChart data={combinedData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLOR_PRIMARY} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLOR_PRIMARY} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="priorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLOR_PRIMARY} stopOpacity={0.1} />
                    <stop offset="95%" stopColor={COLOR_PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yFmt} tick={axisTickStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip
                  formatter={tooltipFmt}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "hsl(140,8%,52%)" }}
                />
                {showYoy && (
                  <Legend
                    wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)", paddingTop: "8px" }}
                  />
                )}
                {/* Prior year — rendered first so current year is on top */}
                {showYoy && (
                  <Area
                    type="monotone"
                    dataKey="adSpendPriorYear"
                    name="Prior Year"
                    connectNulls
                    stroke={COLOR_PRIMARY}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    fill="url(#priorGrad)"
                    dot={false}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="adSpend"
                  name="This Year"
                  connectNulls
                  stroke={COLOR_PRIMARY}
                  strokeWidth={2}
                  fill="url(#spendGrad)"
                  dot={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={combinedData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yFmt} tick={axisTickStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip
                  formatter={tooltipFmt}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "hsl(140,8%,52%)" }}
                />
                {showYoy && (
                  <Legend
                    wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)", paddingTop: "8px" }}
                  />
                )}
                {showYoy && (
                  <Bar
                    dataKey="adSpendPriorYear"
                    name="Prior Year"
                    fill={COLOR_PRIMARY}
                    fillOpacity={0.25}
                    radius={[3, 3, 0, 0]}
                  />
                )}
                <Bar
                  dataKey="adSpend"
                  name="This Year"
                  fill={COLOR_PRIMARY}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            )
          ) : (
            // ── Breakdown by client ──────────────────────────────────────────
            chartType === "area" ? (
              <AreaChart
                data={breakdownData.data}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yFmt} tick={axisTickStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip
                  formatter={(v: number, n: string) => [formatCurrency(v), n]}
                  contentStyle={{ ...tooltipStyle, fontSize: "11px" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)" }} />
                {breakdownData.keys.slice(0, 6).map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.5}
                    fill={CHART_COLORS[i % CHART_COLORS.length] + "22"}
                    dot={false}
                    stackId="a"
                  />
                ))}
              </AreaChart>
            ) : (
              <BarChart
                data={breakdownData.data}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yFmt} tick={axisTickStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip
                  formatter={(v: number, n: string) => [formatCurrency(v), n]}
                  contentStyle={{ ...tooltipStyle, fontSize: "11px" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)" }} />
                {breakdownData.keys.slice(0, 6).map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    radius={[2, 2, 0, 0]}
                    stackId="a"
                  />
                ))}
              </BarChart>
            )
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
