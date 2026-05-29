import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
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

/**
 * Parse a YYYY-MM-DD string into a local-time Date.
 * Using new Date(iso) would parse as UTC midnight and shift the
 * displayed day by the user's UTC offset — this avoids that.
 */
function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Serialize a local Date back to YYYY-MM-DD without UTC shifting. */
function dateToISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
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

  function handleCalendarSelect(date: Date | undefined) {
    if (!date) return;
    const iso = dateToISO(date);
    setLocalDate(iso);
    setSaving(true);
    mutation.mutate(iso);
  }

  const selectedDate = localDate ? isoToLocalDate(localDate) : undefined;

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
        <div className="absolute z-50 top-full left-0 mt-1.5 bg-card border border-border rounded-lg shadow-lg p-3 space-y-2">
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
          {/*
           * Calendar is a React-rendered DayPicker — all month-nav arrows are
           * real DOM nodes inside popoverRef, so mousedown on them correctly
           * satisfies contains() and the popover stays open.
           * Replacing <input type="date"> fixes the premature-close bug caused
           * by the native browser calendar rendering outside the React tree.
           */}
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleCalendarSelect}
            disabled={{ after: new Date() }}
            className="rounded-md"
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

function roasClass(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "text-emerald-500";
  return v >= 7.0 ? "text-green-500 dark:text-green-400" : "text-emerald-500";
}

function EstimatedRoasCell({ row }: { row: ClientSummary }) {
  const [show, setShow] = useState(false);
  const breakdown = useEstimatedBreakdown(row);
  const adSpend = getAdMetrics(row).adSpend ?? 0;
  if (adSpend <= 0) return <span className="text-muted-foreground text-xs">—</span>;
  const roas = Math.round((breakdown.estimatedRevenue / adSpend) * 100) / 100;
  const isHigh = roas >= 7.0;

  return (
    <span
      className="relative inline-flex items-center gap-1 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      data-testid="cell-estimated-roas"
    >
      <Sparkles className={`w-3 h-3 shrink-0 ${isHigh ? "text-green-500 dark:text-green-400" : "text-amber-500"}`} />
      <span className={`font-semibold tabular-nums ${isHigh ? "text-green-500 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
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

  // True when every visible client is leads-based (no e-commerce revenue CRM)
  const isLeadGenView = clients.length > 0 && clients.every((c) => c.client.platform === "LEADGEN");
  // True when every visible client is SEO-only
  const isSEOView = clients.length > 0 && clients.every((c) => c.client.platform === "SEO");

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
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap bg-card";
  const thStatic =
    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap bg-card";

  return (
    <Card className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Client Health</h2>
        <span className="text-xs text-muted-foreground">
          {clients.length} client{clients.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
        <table className="w-full text-sm" data-testid="client-table">
          <thead className="bg-card sticky top-0 z-10 border-b border-border">
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
                {isSEOView ? "Sessions MoM" : "MoM"} <SortIcon field="mom" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("yoy")}
                data-testid="sort-yoy"
              >
                {isSEOView ? "Sessions YoY" : "Spend YoY"} <SortIcon field="yoy" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("ytdSpend")}
                data-testid="sort-ytdspend"
              >
                {isSEOView ? "Total Sessions" : "YTD Spend"} <SortIcon field="ytdSpend" />
              </th>
              {/* Revenue (ecomm) | Leads (leadgen) | Org. Sessions (SEO) */}
              <th
                className={thClass}
                onClick={() => handleSort("revenue")}
                data-testid="sort-revenue"
              >
                {isLeadGenView ? "Leads MTD" : isSEOView ? "Org. Sessions" : "Revenue MTD"} <SortIcon field="revenue" />
              </th>
              <th
                className={thClass}
                onClick={() => handleSort("roas")}
                data-testid="sort-roas"
              >
                {isLeadGenView ? "CPL" : isSEOView ? "Conv." : "ROAS"} <SortIcon field="roas" />
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
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                          client.platform === "SEO"     ? "bg-teal-500/15 text-teal-400" :
                          client.platform === "LEADGEN" ? "bg-amber-500/15 text-amber-400" :
                          client.platform === "IO"      ? "bg-blue-500/15 text-blue-400" :
                          client.platform === "ERS"     ? "bg-violet-500/15 text-violet-400" :
                          client.platform === "ECOMM"   ? "bg-pink-500/15 text-pink-400" :
                                                          "bg-muted/40 text-muted-foreground"
                        }`}>
                          {client.platform}
                        </span>
                        {client.location && (
                          <span className="text-xs text-muted-foreground">{client.location}</span>
                        )}
                      </div>
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

                  {/* MTD Spend — SEO clients have no ad spend */}
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {client.platform === "SEO" ? (
                      <span className="text-xs text-muted-foreground">SEO only</span>
                    ) : (analytics?.adSpend ?? 0) > 0 ? (
                      formatCurrency(analytics.adSpend)
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>

                  {/* MoM — sessions MoM for SEO, spend MoM otherwise */}
                  <td className="px-4 py-3">
                    {client.platform === "SEO" ? (
                      <TrendBadge change={(analytics as any).organicSessionsChange ?? null} />
                    ) : (
                      <TrendBadge change={analytics.adSpendChange} neutral />
                    )}
                  </td>

                  {/* YoY — sessions YoY for SEO, spend YoY otherwise */}
                  <td className="px-4 py-3">
                    {client.platform === "SEO" ? (
                      <TrendBadge change={(analytics as any).organicSessionsYoYChange ?? null} />
                    ) : (
                      <TrendBadge change={analytics.yoyChange} neutral />
                    )}
                  </td>

                  {/* YTD Spend — total sessions for SEO */}
                  <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                    {client.platform === "SEO" ? (
                      (analytics?.sessions ?? 0) > 0 ? (
                        <span>
                          {(analytics.sessions!).toLocaleString()}
                          <span className="text-xs text-muted-foreground font-normal ml-1">sessions</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )
                    ) : (analytics.ytdSpend ?? 0) > 0 ? (
                      formatCurrency(analytics.ytdSpend!)
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>

                  {/* Revenue MTD (ecomm) | Leads MTD (leadgen) | Org. Sessions (SEO) */}
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {client.platform === "SEO" ? (
                      (analytics as any).mtdOrganicSessions > 0 ? (
                        <span className="font-semibold text-foreground">
                          {((analytics as any).mtdOrganicSessions as number).toLocaleString()}
                          <span className="text-xs text-muted-foreground font-normal ml-1">organic</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )
                    ) : client.platform === "LEADGEN" ? (
                      analytics.leads != null && analytics.leads > 0 ? (
                        <span className="font-semibold text-foreground">
                          {analytics.leads.toLocaleString()}
                          <span className="text-xs text-muted-foreground font-normal ml-1">leads</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )
                    ) : (
                      (revenue?.mtd ?? 0) > 0 ? (
                        formatCurrency(revenue.mtd)
                      ) : (
                        <EstimatedCell row={row} />
                      )
                    )}
                  </td>

                  {/* ROAS (ecomm) | CPL (leadgen) | Org. Conversions (SEO) */}
                  <td className="px-4 py-3 tabular-nums">
                    {client.platform === "SEO" ? (
                      (analytics as any).mtdOrganicConversions > 0 ? (
                        <span className="font-semibold text-emerald-500 dark:text-emerald-400">
                          {((analytics as any).mtdOrganicConversions as number).toLocaleString()}
                          <span className="text-xs text-muted-foreground font-normal ml-1">conv.</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )
                    ) : client.platform === "LEADGEN" ? (
                      analytics.leads && analytics.leads > 0 && analytics.adSpend > 0 ? (
                        <span className="font-semibold text-blue-500 dark:text-blue-400">
                          {formatCurrency(analytics.adSpend / analytics.leads)}
                          <span className="text-xs text-muted-foreground font-normal ml-1">CPL</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )
                    ) : analytics?.mtdRoas != null ? (
                      <span className={`font-semibold ${roasClass(analytics.mtdRoas)}`}>
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
