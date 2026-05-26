import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  Sparkles,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ClientSummary, Manager } from "@/pages/Dashboard";
import { getAdMetrics } from "@/pages/Dashboard";
import { estimateRevenue, type Vertical } from "@/lib/revenueEstimator";

interface Props {
  clients: ClientSummary[];
  managers: Manager[];
  selectedManager: string | null;
}

function formatCurrency(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLastTouch(daysAgo: number | null): { label: string; color: string } {
  if (daysAgo === null) return { label: "Never", color: "text-red-500" };
  if (daysAgo === 0) return { label: "Today", color: "text-emerald-500" };
  if (daysAgo === 1) return { label: "Yesterday", color: "text-emerald-500" };
  if (daysAgo <= 7) return { label: `${daysAgo}d ago`, color: "text-emerald-500" };
  if (daysAgo <= 30) return { label: `${daysAgo}d ago`, color: "text-foreground" };
  if (daysAgo <= 60) return { label: `${daysAgo}d ago`, color: "text-amber-500" };
  return { label: `${daysAgo}d ago`, color: "text-red-500" };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function TrendBadge({
  change,
  neutral = false,
}: {
  change: number | null | undefined;
  neutral?: boolean;
}) {
  if (change == null)
    return <span className="text-muted-foreground text-xs">—</span>;

  // Neutral mode (e.g. Spend): show direction arrow but no success/danger colour.
  if (neutral) {
    const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
    return (
      <span className="flex items-center gap-0.5 text-muted-foreground text-xs font-semibold tabular-nums">
        <Icon className="w-3 h-3" />
        {change > 0 ? "+" : ""}
        {change.toFixed(2)}%
      </span>
    );
  }

  if (change > 5)
    return (
      <span className="flex items-center gap-0.5 text-emerald-500 text-xs font-semibold tabular-nums">
        <TrendingUp className="w-3 h-3" />+{change.toFixed(2)}%
      </span>
    );
  if (change < -5)
    return (
      <span className="flex items-center gap-0.5 text-red-500 text-xs font-semibold tabular-nums">
        <TrendingDown className="w-3 h-3" />
        {change.toFixed(2)}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold tabular-nums">
      <Minus className="w-3 h-3" />
      {change > 0 ? "+" : ""}
      {change.toFixed(2)}%
    </span>
  );
}

function ChurnBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  if (risk === "high")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 border border-red-500/20">
        <AlertTriangle className="w-3 h-3" /> High
      </span>
    );
  if (risk === "medium")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
        <Minus className="w-3 h-3" /> Med
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
      <CheckCircle className="w-3 h-3" /> Low
    </span>
  );
}

// ─── Last Touch Cell ──────────────────────────────────────────────────────────
function LastTouchCell({
  clientId,
  health,
}: {
  clientId: string;
  health: ClientSummary["health"] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localDate, setLocalDate] = useState<string | null>(health?.lastTouchDate ?? null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const displayDate = localDate ?? health?.lastTouchDate ?? null;
  const daysAgo =
    displayDate
      ? Math.floor((Date.now() - new Date(displayDate).getTime()) / 86_400_000)
      : null;
  const touch = formatLastTouch(daysAgo);

  const mutation = useMutation({
    mutationFn: (date: string) =>
      apiRequest("PATCH", `/api/clients/${clientId}`, { lastTouchDate: date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setSaving(false);
      setOpen(false);
    },
    onError: () => {
      setSaving(false);
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleLogToday() {
    const date = todayISO();
    setLocalDate(date);
    setSaving(true);
    mutation.mutate(date);
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.value) return;
    setLocalDate(e.target.value);
    setSaving(true);
    mutation.mutate(e.target.value);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 group cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-secondary/60 transition-colors"
        title="Click to log touch"
        disabled={saving}
      >
        <Clock
          className={`w-3.5 h-3.5 ${touch.color} group-hover:text-primary transition-colors`}
        />
        <div className="text-left">
          <span
            className={`text-xs font-medium ${touch.color} group-hover:text-primary transition-colors`}
          >
            {saving ? "Saving…" : touch.label}
          </span>
          {health?.lastTouchNote && (
            <div className="text-xs text-muted-foreground truncate max-w-[130px]">
              {health.lastTouchNote}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1.5 w-56 bg-card border border-border rounded-lg shadow-lg p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Log touch
          </p>
          <button
            onClick={handleLogToday}
            className="w-full text-left px-3 py-2 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
          >
            ✓ Log today ({todayISO()})
          </button>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or pick a date</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <input
            type="date"
            defaultValue={health?.lastTouchDate ?? todayISO()}
            max={todayISO()}
            onChange={handleDateChange}
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
}

// ─── Estimated Revenue Cell ───────────────────────────────────────────────────

const VALID_VERTICALS = new Set<string>(["ERS", "IO", "ECOMM", "LEADGEN"]);
function toVertical(platform: string): Vertical {
  const p = platform.toUpperCase();
  return VALID_VERTICALS.has(p) ? (p as Vertical) : "ERS";
}

function useEstimatedBreakdown(row: ClientSummary) {
  const metrics = getAdMetrics(row);
  return estimateRevenue({
    paidClicks: (metrics as any).clicks ?? 0,
    seoSessions: metrics.sessions ?? 0,
    paidLeads: metrics.leads ?? 0,
    vertical: toVertical(row.client.platform),
  });
}

function EstimatedCell({ row }: { row: ClientSummary }) {
  const [show, setShow] = useState(false);
  const breakdown = useEstimatedBreakdown(row);

  return (
    <span
      className="relative inline-flex items-center gap-1 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      data-testid="cell-estimated-revenue"
    >
      <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
      <span className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">
        ~{formatCurrency(breakdown.estimatedRevenue)}
      </span>
      {show && (
        <span className="absolute z-50 bottom-full left-0 mb-2 w-64 bg-popover border border-border rounded-lg shadow-lg p-3 text-xs text-popover-foreground whitespace-normal">
          <span className="font-semibold block mb-1">Estimated — CRM not connected</span>
          <span className="block text-muted-foreground leading-relaxed mb-2">
            {breakdown.formula || "No traffic data available"}
          </span>
          <span className="block text-muted-foreground border-t border-border pt-1.5">
            Connect CRM in the Clients page to see real revenue.
          </span>
        </span>
      )}
    </span>
  );
}

function EstimatedRoasCell({ row }: { row: ClientSummary }) {
  const [show, setShow] = useState(false);
  const breakdown = useEstimatedBreakdown(row);
  const adSpend = getAdMetrics(row).adSpend ?? 0;
  if (adSpend <= 0) return <span className="text-muted-foreground text-xs">—</span>;
  const roas = Math.round((breakdown.estimatedRevenue / adSpend) * 100) / 100;

  return (
    <span
      className="relative inline-flex items-center gap-1 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      data-testid="cell-estimated-roas"
    >
      <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
      <span className="text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
        ~{roas.toFixed(2)}x
      </span>
      {show && (
        <span className="absolute z-50 bottom-full left-0 mb-2 w-64 bg-popover border border-border rounded-lg shadow-lg p-3 text-xs text-popover-foreground whitespace-normal">
          <span className="font-semibold block mb-1">Estimated ROAS</span>
          <span className="block text-muted-foreground leading-relaxed mb-2">
            ~{formatCurrency(breakdown.estimatedRevenue)} estimated revenue ÷ {formatCurrency(adSpend)} ad spend
          </span>
          <span className="block text-muted-foreground border-t border-border pt-1.5">
            Connect CRM for real revenue data.
          </span>
        </span>
      )}
    </span>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

const MANAGER_COLORS: Record<string, string> = {
  jarvis: "hsl(93, 48%, 55%)",
  jan: "hsl(160, 55%, 42%)",
  adriana: "hsl(37, 91%, 55%)",
};

type SortField =
  | "name"
  | "mtdSpend"
  | "mom"
  | "yoy"
  | "ytdSpend"
  | "roas"
  | "revenue"
  | "lastTouch"
  | "churn";
type SortDir = "asc" | "desc";

export default function ClientTable({ clients, managers, selectedManager }: Props) {
  const [sortField, setSortField] = useState<SortField>("mom");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const getManager = (id: string) => managers.find((m) => m.id === id);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sorted = [...clients].sort((a, b) => {
    let va: number | string = 0;
    let vb: number | string = 0;
    switch (sortField) {
      case "name":
        va = a.client.name;
        vb = b.client.name;
        break;
      case "mtdSpend":
        va = getAdMetrics(a).adSpend ?? 0;
        vb = getAdMetrics(b).adSpend ?? 0;
        break;
      case "mom":
        va = getAdMetrics(a).adSpendChange ?? -999;
        vb = getAdMetrics(b).adSpendChange ?? -999;
        break;
      case "yoy":
        va = getAdMetrics(a).yoyChange ?? -999;
        vb = getAdMetrics(b).yoyChange ?? -999;
        break;
      case "ytdSpend":
        va = getAdMetrics(a).ytdSpend ?? 0;
        vb = getAdMetrics(b).ytdSpend ?? 0;
        break;
      case "roas":
        va = getAdMetrics(a).mtdRoas ?? -999;
        vb = getAdMetrics(b).mtdRoas ?? -999;
        break;
      case "revenue":
        va = a.revenue?.mtd ?? 0;
        vb = b.revenue?.mtd ?? 0;
        break;
      case "lastTouch":
        va = a.health?.lastTouchDaysAgo ?? 9999;
        vb = b.health?.lastTouchDaysAgo ?? 9999;
        break;
      case "churn": {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        va = riskOrder[a.health?.churnRisk ?? "low"];
        vb = riskOrder[b.health?.churnRisk ?? "low"];
        break;
      }
    }
    if (typeof va === "string") {
      return sortDir === "asc"
        ? (va as string).localeCompare(vb as string)
        : (vb as string).localeCompare(va as string);
    }
    return sortDir === "asc"
      ? (va as number) - (vb as number)
      : (vb as number) - (va as number);
  });

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3 h-3 inline ml-0.5" />
    );
  }

  const thClass =
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";
  const thStatic =
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap";

  return (
    <Card className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Client Health</h2>
        <span className="text-xs text-muted-foreground">
          {clients.length} client{clients.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="client-table">
          <thead className="bg-muted/30">
            <tr>
              <th
                className={thClass}
                onClick={() => handleSort("name")}
                data-testid="sort-name"
              >
                Client <SortIcon field="name" />
              </th>
              {!selectedManager && <th className={thStatic}>Manager</th>}
              <th
                className={thClass}
                onClick={() => handleSort("mtdSpend")}
                data-testid="sort-mtdspend"
              >
                MTD Spend <SortIcon field="mtdSpend" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("mom")}
                data-testid="sort-mom"
              >
                MoM <SortIcon field="mom" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("yoy")}
                data-testid="sort-yoy"
              >
                YoY <SortIcon field="yoy" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("ytdSpend")}
                data-testid="sort-ytdspend"
              >
                YTD Spend <SortIcon field="ytdSpend" />
              </th>
              {/* Revenue — context only */}
              <th
                className={thClass}
                onClick={() => handleSort("revenue")}
                data-testid="sort-revenue"
              >
                Revenue MTD <SortIcon field="revenue" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("roas")}
                data-testid="sort-roas"
              >
                ROAS <SortIcon field="roas" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("lastTouch")}
                data-testid="sort-touch"
              >
                Last Touch <SortIcon field="lastTouch" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("churn")}
                data-testid="sort-churn"
              >
                Churn Risk <SortIcon field="churn" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((row) => {
              const { client, revenue, health } = row;
              const analytics = getAdMetrics(row);
              const mgr = getManager(client.managerId);
              const mgrColor =
                MANAGER_COLORS[client.managerId] ?? mgr?.color ?? "#6366f1";

              // YTD spend: sum history for current year

              return (
                <tr
                  key={client.id}
                  className="hover:bg-secondary/30 transition-colors"
                  data-testid={`row-client-${client.id}`}
                >
                  {/* Client name */}
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-foreground text-sm">
                        {client.agencyAnalyticsUrl ? (
                          <a
                            href={client.agencyAnalyticsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary hover:underline transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {client.name}
                          </a>
                        ) : (
                          client.name
                        )}
                      </div>
                      {client.location && (
                        <div className="text-xs text-muted-foreground">
                          {client.location}
                        </div>
                      )}
                    </div>
                  </td>

                  {!selectedManager && mgr && (
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                        style={{
                          background: mgrColor + "20",
                          color: mgrColor,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: mgrColor }}
                        />
                        {mgr.name}
                      </span>
                    </td>
                  )}

                  {/* MTD Spend */}
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {(analytics?.adSpend ?? 0) > 0 ? (
                      formatCurrency(analytics.adSpend)
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>

                  {/* MoM — spend direction is neutral, not success/danger */}
                  <td className="px-4 py-3">
                    <TrendBadge change={analytics.adSpendChange} neutral />
                  </td>

                  {/* YoY — spend direction is neutral, not success/danger */}
                  <td className="px-4 py-3">
                    <TrendBadge change={analytics.yoyChange} neutral />
                  </td>

                  {/* YTD Spend */}
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {(analytics.ytdSpend ?? 0) > 0 ? (
                      formatCurrency(analytics.ytdSpend!)
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>

                  {/* Revenue MTD — real if CRM returned it, estimated otherwise */}
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {(revenue?.mtd ?? 0) > 0 ? (
                      formatCurrency(revenue.mtd)
                    ) : (
                      <EstimatedCell row={row} />
                    )}
                  </td>

                  {/* ROAS — real if CRM returned it, estimated otherwise */}
                  <td className="px-4 py-3 tabular-nums">
                    {analytics?.mtdRoas != null ? (
                      <span className="font-semibold text-emerald-500">
                        {analytics.mtdRoas.toFixed(2)}x
                      </span>
                    ) : (
                      <EstimatedRoasCell row={row} />
                    )}
                  </td>

                  {/* Last Touch */}
                  <td className="px-4 py-3">
                    <LastTouchCell clientId={client.id} health={health} />
                  </td>

                  {/* Churn Risk */}
                  <td className="px-4 py-3">
                    <ChurnBadge risk={health?.churnRisk ?? "low"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
