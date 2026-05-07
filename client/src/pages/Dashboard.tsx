import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/Sidebar";
import RevenueChart from "@/components/RevenueChart";
import ClientTable from "@/components/ClientTable";
import AiChat from "@/components/AiChat";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type Manager = {
  id: string;
  name: string;
  email: string | null;
  color: string;
};

// ── Live API shape (df9cc65 server) ─────────────────────────────────────────
export type AnalyticsSnapshot = {
  id: number;
  clientId: string;
  period: string;        // "2026-05"
  periodType: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  impressions: number;
  clicks: number;
  adSpend: number;
  googleAdSpend: number;
  metaAdSpend: number;
  costPerLead: number;
  leads: number;
  fetchedAt: string;
  roas: number | null;
};

export type AdMetrics = {
  sessions?: number;
  sessionsPrior?: number;
  sessionsChange?: number | null;
  leads?: number;
  leadsPrior?: number;
  leadsChange?: number | null;
  adSpend: number;          // MTD spend (this month)
  adSpendPrior?: number;    // Prior month spend (for MoM)
  adSpendChange?: number | null;   // MoM % change
  yoySpend?: number;        // Same month last year spend
  yoyChange?: number | null;       // YoY % change (MTD vs same month LY)
  ytdSpend?: number;        // Jan–currentMonth this year
  ytdSpendPrior?: number;   // Jan–currentMonth last year
  ytdChange?: number | null;       // YTD YoY % change
  costPerLead?: number;
  conversionRate?: number;
  mtdRoas?: number | null;
  ytdRoas?: number | null;
  history: AnalyticsSnapshot[];
};

export type ClientSummary = {
  client: {
    id: string;
    name: string;
    managerId: string;
    platform: string;
    location: string | null;
    active: boolean | null;
    lastTouchDate: string | null;
    lastTouchNote: string | null;
  };
  // Server may return either "analytics" (old) or "ads" (new) — we normalise in getAdMetrics()
  analytics?: AdMetrics;
  ads?: AdMetrics & {
    mtdSpend?: number;
    momChange?: number | null;
    yoyChange?: number | null;
    ytdSpend?: number;
  };
  revenue: {
    mtd: number;
    mtdPrior?: number;
    mtdChange?: number | null;
    ytd: number;
    ytdPrior?: number;
    ytdChange?: number | null;
    history?: Array<{ period: string; revenue: number; orderCount: number }>;
  };
  health: {
    churnRisk: "low" | "medium" | "high";
    lastTouchDate: string | null;
    lastTouchNote: string | null;
    lastTouchDaysAgo: number | null;
  };
};

/** Normalise whichever shape the server sends, computing YoY/YTD from history */
export function getAdMetrics(c: ClientSummary): AdMetrics {
  const raw = c.analytics ?? c.ads ?? null;
  if (!raw) return { adSpend: 0, history: [] };

  const base: AdMetrics = {
    ...raw,
    adSpend: (raw as any).adSpend ?? (raw as any).mtdSpend ?? 0,
    adSpendChange: (raw as any).adSpendChange ?? (raw as any).momChange ?? null,
  };

  // Always compute YoY / YTD from history so they work regardless of server version
  const history = base.history ?? [];
  const now = new Date();
  const curY = now.getFullYear();
  const curM = String(now.getMonth() + 1).padStart(2, "0");
  const currentPeriod = `${curY}-${curM}`;
  const yoyPeriod    = `${curY - 1}-${curM}`;
  const ytdPrefix    = String(curY);
  const ytdPriorPfx  = String(curY - 1);

  const byPeriod = Object.fromEntries(history.map((h) => [h.period, h.adSpend ?? 0]));

  const mtdSpend  = byPeriod[currentPeriod] ?? base.adSpend;
  const yoySpend  = byPeriod[yoyPeriod] ?? 0;
  const ytdSpend  = Object.entries(byPeriod)
    .filter(([p]) => p.startsWith(ytdPrefix) && p <= currentPeriod)
    .reduce((s, [, v]) => s + v, 0);
  const ytdSpendPrior = Object.entries(byPeriod)
    .filter(([p]) => p.startsWith(ytdPriorPfx) && p <= yoyPeriod)
    .reduce((s, [, v]) => s + v, 0);

  const pct = (a: number, b: number) =>
    b > 0 ? Math.round(((a - b) / b) * 10000) / 100 : null;

  return {
    ...base,
    adSpend: mtdSpend,
    yoySpend,
    yoyChange: yoySpend > 0 ? pct(mtdSpend, yoySpend) : null,
    ytdSpend,
    ytdSpendPrior,
    ytdChange: ytdSpendPrior > 0 ? pct(ytdSpend, ytdSpendPrior) : null,
  };
}

export type DashboardData = {
  totals: {
    mtdRevenue: number;
    mtdRevenueChange: number | null;
    ytdRevenue: number;
    ytdRevenueChange: number | null;
    totalLeads: number;
    totalAdSpend: number;
    totalAdSpendPrior: number;
    totalAdSpendChange: number | null;
    totalSessions: number;
    portfolioMtdRoas: number | null;
    portfolioYtdRoas: number | null;
    clientCount: number;
  };
  clients: ClientSummary[];
};

export default function Dashboard() {
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const { data: managers } = useQuery<Manager[]>({
    queryKey: ["/api/managers"],
  });

  const { data: dashboard, isLoading, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", selectedManager],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/dashboard${selectedManager ? `?managerId=${selectedManager}` : ""}`
      ).then((r) => r.json()),
  });

  const now = new Date();
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  // If a specific client is selected, filter down to just that client
  const visibleClients = selectedClient
    ? (dashboard?.clients ?? []).filter((c) => c.client.id === selectedClient)
    : (dashboard?.clients ?? []);

  // Re-aggregate totals from visibleClients
  const aggregatedTotals = dashboard ? (() => {
    if (!selectedClient) return dashboard.totals;
    const clients = visibleClients;
    const totalAdSpend = clients.reduce((s, c) => s + getAdMetrics(c).adSpend, 0);
    const totalSessions = clients.reduce((s, c) => s + (getAdMetrics(c).sessions ?? 0), 0);
    const totalLeads = clients.reduce((s, c) => s + (getAdMetrics(c).leads ?? 0), 0);
    const mtdRevenue = clients.reduce((s, c) => s + (c.revenue?.mtd ?? 0), 0);
    const ytdRevenue = clients.reduce((s, c) => s + (c.revenue?.ytd ?? 0), 0);
    const totalAdSpendPrior = clients.reduce((s, c) => s + (getAdMetrics(c).adSpendPrior ?? 0), 0);
    const portfolioMtdRoas = totalAdSpend > 0 && mtdRevenue > 0
      ? Math.round((mtdRevenue / totalAdSpend) * 100) / 100 : null;
    return {
      ...dashboard.totals,
      totalAdSpend,
      totalAdSpendPrior,
      totalAdSpendChange: totalAdSpendPrior > 0
        ? Math.round(((totalAdSpend - totalAdSpendPrior) / totalAdSpendPrior) * 10000) / 100
        : null,
      totalSessions,
      totalLeads,
      mtdRevenue,
      ytdRevenue,
      portfolioMtdRoas,
      clientCount: clients.length,
    };
  })() : null;

  // Derive portfolio health counts from YoY ad spend per client
  const growing = visibleClients.filter(
    (c) => (getAdMetrics(c).yoyChange ?? 0) > 5
  ).length;
  const declining = visibleClients.filter(
    (c) => (getAdMetrics(c).yoyChange ?? 0) < -5
  ).length;
  const flat = visibleClients.length - growing - declining;

  return (
    <div className="dashboard-grid">
      <Sidebar
        managers={managers ?? []}
        selectedManager={selectedManager}
        onSelectManager={setSelectedManager}
      />

      <main className="main-area bg-background">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {selectedManager
                ? `${managers?.find((m) => m.id === selectedManager)?.name}'s Clients`
                : "All Clients — Overview"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">{monthLabel} · Live data</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setChatOpen(true)}
              data-testid="button-open-chat"
              className="gap-1.5 text-xs"
              style={{ background: "hsl(93, 48%, 55%)", color: "hsl(150, 18%, 8%)" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ask AI
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : dashboard && aggregatedTotals ? (
            <>
              {/* Client selector */}
              <ClientSelector
                clients={dashboard.clients}
                selectedClient={selectedClient}
                onSelect={(id) => {
                  setSelectedClient(id);
                }}
              />
              <HealthSummaryCards
                dashboard={{ ...dashboard, totals: aggregatedTotals, clients: visibleClients }}
                growing={growing}
                flat={flat}
                declining={declining}
              />
            </>
          ) : null}

          {dashboard && visibleClients.length > 0 && (
            <RevenueChart clients={visibleClients} />
          )}

          {isLoading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : dashboard ? (
            <ClientTable
              clients={visibleClients}
              managers={managers ?? []}
              selectedManager={selectedManager}
            />
          ) : null}
        </div>
      </main>

      <AiChat
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        selectedManager={selectedManager}
        managers={managers ?? []}
        dashboardData={dashboard}
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function StatChange({ change, label }: { change: number | null | undefined; label: string }) {
  if (change == null)
    return <span className="text-xs text-muted-foreground">— {label}</span>;
  const up = change > 0;
  const down = change < 0;
  return (
    <span
      className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
        up ? "text-emerald-500" : down ? "text-red-500" : "text-muted-foreground"
      }`}
    >
      {up ? (
        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
      ) : down ? (
        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <Minus className="w-3.5 h-3.5 shrink-0" />
      )}
      {change > 0 ? "+" : ""}
      {change.toFixed(1)}% {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`p-5 rounded-lg border ${
        highlight ? "bg-primary/5 border-primary/30" : "bg-card border-border"
      }`}
    >
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">
        {label}
      </p>
      <div className="text-2xl font-bold tabular-nums text-foreground leading-tight">{value}</div>
      {sub && <div className="mt-2">{sub}</div>}
    </Card>
  );
}


// ─── Client Selector ─────────────────────────────────────────────────────────

function ClientSelector({
  clients,
  selectedClient,
  onSelect,
}: {
  clients: ClientSummary[];
  selectedClient: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (clients.length <= 1) return null; // no selector needed for single client

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="client-selector">
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mr-1">
        View:
      </span>
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
          selectedClient === null
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
        }`}
      >
        All Clients
      </button>
      {clients.map((c) => (
        <button
          key={c.client.id}
          onClick={() => onSelect(selectedClient === c.client.id ? null : c.client.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            selectedClient === c.client.id
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          {c.client.name}
        </button>
      ))}
    </div>
  );
}

// ─── Health Summary Cards ─────────────────────────────────────────────────────

function HealthSummaryCards({
  dashboard,
  growing,
  flat,
  declining,
}: {
  dashboard: DashboardData;
  growing: number;
  flat: number;
  declining: number;
}) {
  const {
    totalAdSpend,
    totalAdSpendChange,
    totalLeads,
    totalSessions,
    mtdRevenue,
    ytdRevenue,
    portfolioMtdRoas,
    clientCount,
  } = dashboard.totals;

  // Aggregate YoY and YTD from getAdMetrics (computed from history client-side)
  const portfolioMetrics = dashboard.clients.reduce(
    (acc, c) => {
      const m = getAdMetrics(c);
      return {
        yoySpend:      acc.yoySpend      + (m.yoySpend      ?? 0),
        ytdSpend:      acc.ytdSpend      + (m.ytdSpend      ?? 0),
        ytdSpendPrior: acc.ytdSpendPrior + (m.ytdSpendPrior ?? 0),
      };
    },
    { yoySpend: 0, ytdSpend: 0, ytdSpendPrior: 0 }
  );

  const pct = (a: number, b: number) =>
    b > 0 ? Math.round(((a - b) / b) * 10000) / 100 : null;

  const portfolioYoyChange = portfolioMetrics.yoySpend > 0
    ? pct(totalAdSpend, portfolioMetrics.yoySpend)
    : null;
  const portfolioYtdChange = portfolioMetrics.ytdSpendPrior > 0
    ? pct(portfolioMetrics.ytdSpend, portfolioMetrics.ytdSpendPrior)
    : null;

  return (
    <div className="space-y-3" data-testid="health-summary">
      {/* Row 1 — Ad Performance */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">
          Ad Performance
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="MTD Spend"
            highlight
            value={
              totalAdSpend > 0 ? (
                formatCurrency(totalAdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <div className="space-y-1">
                <StatChange change={totalAdSpendChange} label="MoM" />
                <StatChange change={portfolioYoyChange} label="YoY" />
              </div>
            }
          />

          <KpiCard
            label="YTD Spend"
            highlight
            value={
              portfolioMetrics.ytdSpend > 0 ? (
                formatCurrency(portfolioMetrics.ytdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<StatChange change={portfolioYtdChange} label="vs last year" />}
          />

          <KpiCard
            label="Portfolio Health"
            value={
              <span>
                {clientCount}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  client{clientCount !== 1 ? "s" : ""}
                </span>
              </span>
            }
            sub={
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  {growing} growing
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  {flat} flat
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-red-500">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  {declining} down
                </span>
              </div>
            }
          />

          <KpiCard
            label="MTD ROAS"
            value={
              portfolioMtdRoas != null ? (
                `${portfolioMtdRoas.toFixed(1)}x`
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">
                {portfolioMtdRoas != null
                  ? `$${portfolioMtdRoas.toFixed(2)} rev per $1 spent`
                  : "Awaiting revenue data"}
              </span>
            }
          />
        </div>
      </div>

      {/* Row 2 — Supporting metrics + Revenue */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">
          Supporting Metrics
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="MTD Leads"
            value={
              totalLeads > 0 ? (
                totalLeads.toLocaleString()
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<span className="text-xs text-muted-foreground">from Meta campaigns</span>}
          />

          <KpiCard
            label="MTD Sessions"
            value={
              totalSessions > 0 ? (
                totalSessions.toLocaleString()
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<span className="text-xs text-muted-foreground">from Google Analytics</span>}
          />

          <KpiCard
            label="Revenue MTD"
            value={
              mtdRevenue > 0 ? (
                formatCurrency(mtdRevenue)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<span className="text-xs text-muted-foreground">from ERS / IO / CRM</span>}
          />

          <KpiCard
            label="Revenue YTD"
            value={
              ytdRevenue > 0 ? (
                formatCurrency(ytdRevenue)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<span className="text-xs text-muted-foreground">from ERS / IO / CRM</span>}
          />
        </div>
      </div>
    </div>
  );
}
