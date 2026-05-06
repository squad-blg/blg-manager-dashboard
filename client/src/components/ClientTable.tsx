import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Clock, AlertTriangle, CheckCircle, ExternalLink } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ClientSummary, Manager } from "@/pages/Dashboard";

interface Props {
  clients: ClientSummary[];
  managers: Manager[];
  selectedManager: string | null;
}

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TrendBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (change > 5)
    return (
      <span className="flex items-center gap-0.5 text-emerald-500 text-xs font-semibold tabular-nums">
        <TrendingUp className="w-3 h-3" />+{change.toFixed(1)}%
      </span>
    );
  if (change < -5)
    return (
      <span className="flex items-center gap-0.5 text-red-500 text-xs font-semibold tabular-nums">
        <TrendingDown className="w-3 h-3" />{change.toFixed(1)}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold tabular-nums">
      <Minus className="w-3 h-3" />{change > 0 ? "+" : ""}{change.toFixed(1)}%
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
function LastTouchCell({ clientId, health }: {
  clientId: string;
  health: ClientSummary["health"] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Optimistic local date — shown immediately on save, confirmed by server refetch
  const [localDate, setLocalDate] = useState<string | null>(health?.lastTouchDate ?? null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Keep localDate in sync if parent data refreshes
  const serverDate = health?.lastTouchDate ?? null;
  const displayDate = localDate ?? serverDate;
  const daysAgo = displayDate
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
      // Keep optimistic value — it'll sync on next load
      setSaving(false);
      setOpen(false);
    },
  });

  // Close on outside click
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
    const date = e.target.value;
    setLocalDate(date);
    setSaving(true);
    mutation.mutate(date);
  }

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 group cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-secondary/60 transition-colors"
        title="Click to log touch"
        disabled={saving}
      >
        <Clock className={`w-3.5 h-3.5 ${touch.color} group-hover:text-primary transition-colors`} />
        <div className="text-left">
          <span className={`text-xs font-medium ${touch.color} group-hover:text-primary transition-colors`}>
            {saving ? "Saving…" : touch.label}
          </span>
          {health?.lastTouchNote && (
            <div className="text-xs text-muted-foreground truncate max-w-[130px]">
              {health.lastTouchNote}
            </div>
          )}
        </div>
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1.5 w-56 bg-card border border-border rounded-lg shadow-lg p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Log touch</p>

          {/* Log today button */}
          <button
            onClick={handleLogToday}
            className="w-full text-left px-3 py-2 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
          >
            ✓ Log today ({todayISO()})
          </button>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or pick a date</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Date picker */}
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

// ─── Main Table ───────────────────────────────────────────────────────────────

const MANAGER_COLORS: Record<string, string> = {
  jarvis: "hsl(93, 48%, 55%)",
  jan: "hsl(160, 55%, 42%)",
  adriana: "hsl(37, 91%, 55%)",
};

type SortField = "name" | "mtd" | "mom" | "ytd" | "yoy" | "adSpend" | "roas" | "lastTouch" | "churn";
type SortDir = "asc" | "desc";

// Build the Agency Analytics URL for a client
// AA client dashboard URL pattern: https://app.agencyanalytics.com/dashboard/{campaignId}
function aaUrl(aaaCampaignId: string | null | undefined): string | null {
  if (!aaaCampaignId) return null;
  return `https://app.agencyanalytics.com/dashboard/${aaaCampaignId}`;
}

export default function ClientTable({ clients, managers, selectedManager }: Props) {
  const [sortField, setSortField] = useState<SortField>("yoy");
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
        va = a.client.name; vb = b.client.name; break;
      case "mtd":
        va = a.revenue.mtd; vb = b.revenue.mtd; break;
      case "mom":
        va = a.revenue.mtdChange ?? -999; vb = b.revenue.mtdChange ?? -999; break;
      case "ytd":
        va = a.revenue.ytd; vb = b.revenue.ytd; break;
      case "yoy":
        va = a.revenue.ytdChange ?? -999; vb = b.revenue.ytdChange ?? -999; break;
      case "adSpend":
        va = a.analytics.adSpend; vb = b.analytics.adSpend; break;
      case "roas":
        va = a.analytics.mtdRoas ?? -999; vb = b.analytics.mtdRoas ?? -999; break;
      case "lastTouch":
        va = a.health?.lastTouchDaysAgo ?? 9999; vb = b.health?.lastTouchDaysAgo ?? 9999; break;
      case "churn": {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        va = riskOrder[a.health?.churnRisk ?? "low"]; vb = riskOrder[b.health?.churnRisk ?? "low"]; break;
      }
    }
    if (typeof va === "string") {
      return sortDir === "asc"
        ? (va as string).localeCompare(vb as string)
        : (vb as string).localeCompare(va as string);
    }
    return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
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
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none";
  const thStatic =
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider";

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
              <th className={thClass} onClick={() => handleSort("name")} data-testid="sort-name">
                Client <SortIcon field="name" />
              </th>
              {!selectedManager && (
                <th className={thStatic}>Manager</th>
              )}
              <th className={thClass} onClick={() => handleSort("mtd")} data-testid="sort-mtd">
                MTD Rev <SortIcon field="mtd" />
              </th>
              <th className={thClass} onClick={() => handleSort("mom")} data-testid="sort-mom">
                MoM <SortIcon field="mom" />
              </th>
              <th className={thClass} onClick={() => handleSort("ytd")} data-testid="sort-ytd">
                YTD Rev <SortIcon field="ytd" />
              </th>
              <th className={thClass} onClick={() => handleSort("yoy")} data-testid="sort-yoy">
                YoY <SortIcon field="yoy" />
              </th>
              <th className={thClass} onClick={() => handleSort("adSpend")} data-testid="sort-adspend">
                Ad Spend <SortIcon field="adSpend" />
              </th>
              <th className={thClass} onClick={() => handleSort("roas")} data-testid="sort-roas">
                ROAS <SortIcon field="roas" />
              </th>
              <th className={thClass} onClick={() => handleSort("lastTouch")} data-testid="sort-touch">
                Last Touch <SortIcon field="lastTouch" />
              </th>
              <th className={thClass} onClick={() => handleSort("churn")} data-testid="sort-churn">
                Churn Risk <SortIcon field="churn" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map(({ client, revenue, health }) => {
              const mgr = getManager(client.managerId);
              const mgrColor = MANAGER_COLORS[client.managerId] ?? mgr?.color ?? "#6366f1";
              const dashboardUrl = aaUrl((client as any).aaaCampaignId);
              return (
                <tr
                  key={client.id}
                  className="hover:bg-secondary/30 transition-colors"
                  data-testid={`row-client-${client.id}`}
                >
                  {/* Client name — links to AA if campaign ID set */}
                  <td className="px-4 py-3">
                    <div>
                      {dashboardUrl ? (
                        <a
                          href={dashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-foreground text-sm hover:text-primary transition-colors group"
                        >
                          {client.name}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </a>
                      ) : (
                        <div className="font-medium text-foreground text-sm">{client.name}</div>
                      )}
                      {client.location && (
                        <div className="text-xs text-muted-foreground">{client.location}</div>
                      )}
                    </div>
                  </td>
                  {!selectedManager && mgr && (
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                        style={{ background: mgrColor + "20", color: mgrColor }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: mgrColor }} />
                        {mgr.name}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {formatCurrency(revenue.mtd)}
                  </td>
                  <td className="px-4 py-3">
                    <TrendBadge change={revenue.mtdChange} />
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {formatCurrency(revenue.ytd)}
                  </td>
                  <td className="px-4 py-3">
                    <TrendBadge change={revenue.ytdChange} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {analytics.adSpend > 0 ? formatCurrency(analytics.adSpend) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {analytics.mtdRoas !== null
                      ? <span className="font-semibold text-emerald-500">{analytics.mtdRoas.toFixed(1)}x</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <LastTouchCell clientId={client.id} health={health} />
                  </td>
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
