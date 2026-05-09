import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { ClientSummary } from "@/pages/Dashboard";
import { getAdMetrics } from "@/pages/Dashboard";

interface Props {
  clients: ClientSummary[];
}

const COLOR_SPEND   = "hsl(93, 48%, 50%)";
const COLOR_REVENUE = "hsl(37, 91%, 55%)";
const COLOR_ROAS    = "hsl(200, 80%, 60%)";
const CHART_COLORS  = [
  "hsl(93, 48%, 55%)",
  "hsl(160, 55%, 42%)",
  "hsl(37, 91%, 55%)",
  "hsl(280, 50%, 60%)",
  "hsl(340, 65%, 55%)",
  "hsl(120, 40%, 45%)",
];

function fmtCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtCurrencyFull(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortMonth(period: string) {
  const [y, m] = period.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Custom tooltip
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "hsl(150,16%,10%)",
      border: "1px solid hsl(150,12%,20%)",
      borderRadius: "8px",
      padding: "10px 14px",
      fontSize: "12px",
      color: "hsl(140,15%,90%)",
      minWidth: "160px",
    }}>
      <p style={{ color: "hsl(140,8%,60%)", marginBottom: "6px", fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginBottom: "3px" }}>
          <span style={{ color: p.color, display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
            {p.name}
          </span>
          <span style={{ fontWeight: 600 }}>
            {p.dataKey === "roas" ? `${Number(p.value).toFixed(2)}x` : fmtCurrencyFull(p.value)}
          </span>
        </div>
      ))}
      {payload.find((p: any) => p.dataKey === "adSpend") && payload.find((p: any) => p.dataKey === "revenue") && (() => {
        const spend = payload.find((p: any) => p.dataKey === "adSpend")?.value ?? 0;
        const rev = payload.find((p: any) => p.dataKey === "revenue")?.value ?? 0;
        if (spend > 0 && rev > 0) {
          return (
            <div style={{ borderTop: "1px solid hsl(150,12%,20%)", marginTop: "6px", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: COLOR_ROAS }}>ROAS</span>
              <span style={{ fontWeight: 600, color: COLOR_ROAS }}>{(rev / spend).toFixed(2)}x</span>
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
};

export default function RevenueChart({ clients }: Props) {
  const [mode, setMode] = useState<"combined" | "breakdown">("combined");
  const [showSpend, setShowSpend] = useState(true);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showRoas, setShowRoas] = useState(false);

  const currentPeriod = getCurrentPeriod();

  // ── Combined data ─────────────────────────────────────────────────────────
  const combinedData = useMemo(() => {
    if (!clients.length) return [];

    const spendMap = new Map<string, number>();
    const revenueMap = new Map<string, number>();

    clients.forEach((c) => {
      // Ad spend from history
      (getAdMetrics(c).history ?? []).forEach((h) => {
        spendMap.set(h.period, (spendMap.get(h.period) ?? 0) + (h.adSpend ?? 0));
      });
      // Revenue from revenue history
      (c.revenue?.history ?? []).forEach((r: any) => {
        revenueMap.set(r.period, (revenueMap.get(r.period) ?? 0) + (r.revenue ?? 0));
      });
    });

    // All periods with spend data, sorted, last 13 months, exclude current incomplete month
    const periods = Array.from(spendMap.keys())
      .filter(p => p !== currentPeriod) // hide incomplete current month
      .sort()
      .slice(-13);

    return periods.map((period) => {
      const spend = Math.round(spendMap.get(period) ?? 0);
      const revenue = Math.round(revenueMap.get(period) ?? 0);
      const roas = spend > 0 && revenue > 0 ? Math.round((revenue / spend) * 100) / 100 : null;
      return {
        period,
        label: shortMonth(period),
        adSpend: spend,
        revenue: revenue > 0 ? revenue : null,
        roas,
      };
    });
  }, [clients, currentPeriod]);

  // ── Breakdown per client ──────────────────────────────────────────────────
  const breakdownData = useMemo(() => {
    if (!clients.length) return { data: [], keys: [] };
    const periodSet = new Set<string>();
    clients.forEach((c) =>
      (getAdMetrics(c).history ?? []).forEach((h) => {
        if (h.period !== currentPeriod) periodSet.add(h.period);
      })
    );
    const periods = Array.from(periodSet).sort().slice(-13);
    const data = periods.map((period) => {
      const row: Record<string, any> = { period, label: shortMonth(period) };
      clients.forEach((c) => {
        const h = (getAdMetrics(c).history ?? []).find((x) => x.period === period);
        row[c.client.name] = Math.round(h?.adSpend ?? 0);
      });
      return row;
    });
    return { data, keys: clients.map((c) => c.client.name) };
  }, [clients, currentPeriod]);

  const axisTickStyle = { fill: "hsl(140,8%,52%)", fontSize: 11 };
  const gridStyle = { strokeDasharray: "3 3", stroke: "hsl(150,12%,17%)", vertical: false };

  const hasRevenue = combinedData.some(d => d.revenue != null && d.revenue > 0);
  const maxSpend = Math.max(...combinedData.map(d => d.adSpend ?? 0));
  const maxRevenue = Math.max(...combinedData.map(d => d.revenue ?? 0));

  return (
    <Card className="bg-card border border-border rounded-lg p-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Performance Trend — Last 12 Months
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "combined"
              ? "Ad spend vs revenue by month (current month excluded — in progress)"
              : "Per-client ad spend breakdown"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle overlays */}
          {mode === "combined" && (
            <div className="flex gap-1.5">
              <button
                  onClick={() => setShowSpend(v => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    showSpend
                      ? "border-primary/50 text-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  Ad Spend
                </button>
              {hasRevenue && (
                <button
                  onClick={() => setShowRevenue(v => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    showRevenue
                      ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  Revenue
                </button>
              )}
              {hasRevenue && (
                <button
                  onClick={() => setShowRoas(v => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    showRoas
                      ? "border-sky-500/50 text-sky-400 bg-sky-500/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  ROAS line
                </button>
              )}

            </div>
          )}

          {/* Mode */}
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
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
        </div>
      </div>

      {/* Chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "combined" ? (
            <ComposedChart
              data={combinedData}
              margin={{ top: 5, right: (showRoas || (showRevenue && showSpend)) ? 55 : 10, left: 0, bottom: 0 }}
              barCategoryGap="30%"
              barGap={4}
            >
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
              {/* Revenue Y axis left */}
              <YAxis
                yAxisId="revenue"
                orientation="left"
                tickFormatter={fmtCurrency}
                tick={{ ...axisTickStyle, fill: COLOR_REVENUE }}
                axisLine={false}
                tickLine={false}
                width={55}
                hide={!showRevenue}
                domain={[0, maxRevenue > 0 ? maxRevenue * 1.15 : "auto"]}
              />
              {/* Spend Y axis right */}
              <YAxis
                yAxisId="spend"
                orientation={showRevenue ? "right" : "left"}
                tickFormatter={fmtCurrency}
                tick={{ ...axisTickStyle, fill: COLOR_SPEND }}
                axisLine={false}
                tickLine={false}
                width={showRevenue ? 50 : 55}
                hide={!showSpend}
                domain={[0, maxSpend > 0 ? maxSpend * 1.15 : "auto"]}
              />
              {showRoas && (
                <YAxis
                  yAxisId="roas"
                  orientation="right"
                  tickFormatter={(v) => `${v}x`}
                  tick={{ ...axisTickStyle, fill: COLOR_ROAS }}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)", paddingTop: "10px" }} />
              {showRevenue && (
                <Bar
                  yAxisId="revenue"
                  dataKey="revenue"
                  name="Revenue"
                  fill={COLOR_REVENUE}
                  fillOpacity={0.85}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              )}
              {showSpend && (
                <Bar
                  yAxisId="spend"
                  dataKey="adSpend"
                  name="Ad Spend"
                  fill={COLOR_SPEND}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              )}
              {showRoas && (
                <Line
                  yAxisId="roas"
                  type="monotone"
                  dataKey="roas"
                  name="ROAS"
                  stroke={COLOR_ROAS}
                  strokeWidth={2}
                  dot={{ fill: COLOR_ROAS, r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              )}
            </ComposedChart>
          ) : (
            <ComposedChart data={breakdownData.data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="label" tick={axisTickStyle} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="spend"
                tickFormatter={fmtCurrency}
                tick={axisTickStyle}
                axisLine={false}
                tickLine={false}
                width={55}
              />
              <Tooltip
                formatter={(v: number, n: string) => [fmtCurrencyFull(v), n]}
                contentStyle={{
                  background: "hsl(150,16%,10%)",
                  border: "1px solid hsl(150,12%,20%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(140,8%,52%)", paddingTop: "10px" }} />
              {breakdownData.keys.slice(0, 6).map((key, i) => (
                <Bar
                  key={key}
                  yAxisId="spend"
                  dataKey={key}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[2, 2, 0, 0]}
                  stackId="a"
                  maxBarSize={40}
                />
              ))}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Summary stats below chart */}
      {mode === "combined" && combinedData.length > 0 && (() => {
        const last3 = combinedData.slice(-3);
        const avgSpend = last3.reduce((s, d) => s + d.adSpend, 0) / last3.length;
        const avgRevenue = last3.filter(d => d.revenue).reduce((s, d) => s + (d.revenue ?? 0), 0) / last3.filter(d => d.revenue).length;
        const avgRoas = avgSpend > 0 && avgRevenue > 0 ? avgRevenue / avgSpend : null;
        return (
          <div className="flex gap-6 mt-4 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground">3-Month Avg Spend</p>
              <p className="text-sm font-semibold text-foreground">{fmtCurrencyFull(avgSpend)}</p>
            </div>
            {avgRevenue > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">3-Month Avg Revenue</p>
                <p className="text-sm font-semibold text-foreground">{fmtCurrencyFull(avgRevenue)}</p>
              </div>
            )}
            {avgRoas && (
              <div>
                <p className="text-xs text-muted-foreground">3-Month Avg ROAS</p>
                <p className="text-sm font-semibold" style={{ color: COLOR_ROAS }}>{avgRoas.toFixed(2)}x</p>
              </div>
            )}
          </div>
        );
      })()}
    </Card>
  );
}
