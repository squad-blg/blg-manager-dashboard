import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: number;
  change?: number | null;
  format: "currency" | "number" | "percent";
  subtitle?: string;
}

function formatValue(value: number, format: KpiCardProps["format"]) {
  if (format === "currency") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export default function KpiCard({ label, value, change, format, subtitle }: KpiCardProps) {
  const isPositive = change !== null && change !== undefined && change > 0;
  const isNegative = change !== null && change !== undefined && change < 0;
  const isFlat = change !== null && change !== undefined && change === 0;

  return (
    <Card
      className="kpi-card p-5 bg-card border border-border rounded-lg"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums text-foreground animate-count">
        {formatValue(value, format)}
      </p>
      <div className="flex items-center gap-1.5 mt-2">
        {change !== null && change !== undefined ? (
          <>
            {isPositive && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
            {isNegative && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
            {isFlat && <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
            <span
              className={`text-xs font-semibold tabular-nums ${
                isPositive
                  ? "text-emerald-400"
                  : isNegative
                  ? "text-red-400"
                  : "text-muted-foreground"
              }`}
            >
              {isPositive ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </>
        ) : null}
        {subtitle && (
          <span className="text-xs text-muted-foreground ml-auto">{subtitle}</span>
        )}
      </div>
    </Card>
  );
}
