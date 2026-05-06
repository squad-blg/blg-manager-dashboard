import {
  LineChart,
  Line,
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
  const [view, setView] = useState<"revenue" | "leads" | "adspend" | "roas">("revenue");

  // Build combined monthly dataset (last 12 months)
  const combinedData = useMemo(() => {
    if (!clients.length) return [];
    const periodSet = new Set<string>();
    clients.forEach((c) => c.revenue.history.forEach((h) => periodSet.add(h.period)));
    const periods = Array.from(periodSet).sort().slice(-12);

    return periods.map((period) => {
      const row: Record<string, any> = { period, label: shortMonth(period) };
      let totalRevenue = 0;
      let totalLeads = 0;
      let totalAdSpend = 0;
      clients.forEach((c) => {
        const r = c.revenue.history.find((h) => h.period === period);
        const a = c.analytics.history.find((h) => h.period === period);
        totalRevenue += r?.revenue ?? 0;
        totalLeads += a?.leads ?? 0;
        totalAdSpend += a?.adSpend ?? 0;
      });
      row.revenue = Math.round(totalRevenue);
      row.leads = totalLeads;
      row.adSpend = Math.round(totalAdSpend);
      row.roas = totalAdSpend > 0 && totalRevenue > 0
        ? Math.round((totalRevenue / totalAdSpend) * 100) / 100
        : null;
      return row;
    });
  }, [clients]);

  // Per-client breakdown
  const breakdownData = useMemo(() => {
    if (!clients.length) return { data: [], keys: [] };
    const periodSet = new Set<string>();
    clients.forEach((c) => c.revenue.history.forEach((h) => periodSet.add(h.period)));
    const periods = Array.from(periodSet).sort().slice(-12);

    const data = periods.map((period) => {
      const row: Record<string, any> = { period, label: shortMonth(period) };
      clients.forEach((c) => {
        const r = c.revenue.history.find((h) => h.period === period);
        row[c.client.name] = Math.round(r?.revenue ?? 0);
      });
      return row;
    });

    return { data, keys: clients.map((c) => c.client.name) };
  }, [clients]);

  const viewLabels = {
    revenue: "Revenue",
    leads: "Leads",
    adspend: "Ad Spend",
    roas: "ROAS",
  };

  const tooltipFormatter = (value: number, name: string) => {
    if (view === "revenue" || view === "adspend") return [formatCurrency(value), name];
    if (view === "roas") return [`${value.toFixed(1)}x`, name];
    return [value.toLocaleString(), name];
  };

  const yTickFormatter = (v: number) => {
    if (view === "revenue" || view === "adspend") return formatCurrency(v);
    if (view === "roas") return `${v.toFixed(1)}x`;
    return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);
  };

  return (
    <Card className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {viewLabels[view]} Trend — Last 12 Months
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "combined" ? "Aggregated across selected clients" : "Per-client breakdown"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View selector */}
          <div className="flex rounded-md overflow-hidden border border-border">
            {(["revenue", "leads", "adspend", "roas"] as const).map((v) => (
              <button
                key={v}
                data-testid={`chart-view-${v}`}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {viewLabels[v]}
              </button>
            ))}
          </div>
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
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(93, 48%, 55%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(93, 48%, 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={yTickFormatter}
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={tooltipFormatter}
                  contentStyle={{
                    background: "hsl(150,16%,10%)",
                    border: "1px solid hsl(150,12%,17%)",
                    borderRadius: "6px",
                    color: "hsl(140,15%,90%)",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "hsl(140,8%,52%)" }}
                />
                <Area
                  type="monotone"
                  dataKey={view === "adspend" ? "adSpend" : view}
                  connectNulls
                  stroke="hsl(93, 48%, 55%)"
                  strokeWidth={2}
                  fill="url(#revGrad)"
                  dot={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={combinedData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={yTickFormatter}
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={tooltipFormatter}
                  contentStyle={{
                    background: "hsl(150,16%,10%)",
                    border: "1px solid hsl(150,12%,17%)",
                    borderRadius: "6px",
                    color: "hsl(140,15%,90%)",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey={view === "adspend" ? "adSpend" : view}
                  fill="hsl(93, 48%, 55%)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            )
          ) : (
            // Breakdown by client — always bar/area per client
            chartType === "area" ? (
              <AreaChart
                data={breakdownData.data}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,12%,17%)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={yTickFormatter}
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(v: number, n: string) => [formatCurrency(v), n]}
                  contentStyle={{
                    background: "hsl(150,16%,10%)",
                    border: "1px solid hsl(150,12%,17%)",
                    borderRadius: "6px",
                    color: "hsl(140,15%,90%)",
                    fontSize: "11px",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)" }}
                />
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
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={yTickFormatter}
                  tick={{ fill: "hsl(140,8%,52%)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(v: number, n: string) => [formatCurrency(v), n]}
                  contentStyle={{
                    background: "hsl(150,16%,10%)",
                    border: "1px solid hsl(150,12%,17%)",
                    borderRadius: "6px",
                    color: "hsl(140,15%,90%)",
                    fontSize: "11px",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)" }}
                />
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
