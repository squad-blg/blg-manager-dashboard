import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/Sidebar";
import RevenueChart from "@/components/RevenueChart";
import ClientTable from "@/components/ClientTable";
import AiChat from "@/components/AiChat";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Sparkles, TrendingUp, AlertTriangle, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type Manager = {
  id: string;
  name: string;
  email: string | null;
  color: string;
};

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
  revenue: {
    mtd: number;
    mtdPrior: number;
    mtdChange: number | null;
    ytd: number;
    ytdPrior: number;
    ytdChange: number | null;
    history: Array<{ period: string; revenue: number; orderCount: number | null }>;
  };
  analytics: {
    sessions: number;
    leads: number;
    leadsChange: number | null;
    adSpend: number;
    adSpendPrior: number;
    adSpendChange: number | null;
    costPerLead: number;
    conversionRate: number;
    mtdRoas: number | null;
    ytdRoas: number | null;
    history: Array<{ period: string; sessions: number | null; leads: number | null; adSpend: number | null; roas: number | null }>;
  };
  health: {
    churnRisk: "low" | "medium" | "high";
    lastTouchDate: string | null;
    lastTouchNote: string | null;
    lastTouchDaysAgo: number | null;
  };
};

export default function Dashboard() {
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
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
          {/* Health Summary Cards */}
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : dashboard ? (
            <HealthSummaryCards dashboard={dashboard} />
          ) : null}

          {/* Revenue Chart */}
          {dashboard && dashboard.clients.length > 0 && (
            <RevenueChart clients={dashboard.clients} />
          )}

          {/* Client table */}
          {isLoading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : dashboard ? (
            <ClientTable
              clients={dashboard.clients}
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

// ─── Health Summary Cards ──────────────────────────────────────────────────

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function HealthSummaryCards({ dashboard }: { dashboard: DashboardData }) {
  const growing = dashboard.clients.filter((c) => (c.revenue.ytdChange ?? 0) > 5).length;
  const declining = dashboard.clients.filter((c) => (c.revenue.ytdChange ?? 0) < -5).length;
  const flat = dashboard.clients.length - growing - declining;

  const { mtdRevenue, mtdRevenueChange, ytdRevenue, ytdRevenueChange,
          totalAdSpend, totalAdSpendChange, portfolioMtdRoas, clientCount } = dashboard.totals;

  function StatChange({ change, suffix = "%", invertColor = false }: { change: number | null | undefined; suffix?: string; invertColor?: boolean }) {
    if (change == null) return <span className="text-xs text-muted-foreground">—</span>;
    const positive = invertColor ? change < 0 : change > 0;
    const negative = invertColor ? change > 0 : change < 0;
    return (
      <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
        positive ? "text-emerald-500" : negative ? "text-red-500" : "text-muted-foreground"
      }`}>
        {positive ? <TrendingUp className="w-3.5 h-3.5" /> : negative ? <AlertTriangle className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        {change > 0 ? "+" : ""}{change.toFixed(1)}{suffix}
      </span>
    );
  }

  return (
    <div className="space-y-3" data-testid="health-summary">
      {/* Row 1: Revenue */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">Revenue</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* MTD Revenue */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD Revenue</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(mtdRevenue)}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <StatChange change={mtdRevenueChange} suffix="% MoM" />
            </div>
          </Card>

          {/* YTD Revenue */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">YTD Revenue</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(ytdRevenue)}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <StatChange change={ytdRevenueChange} suffix="% YoY" />
            </div>
          </Card>

          {/* Portfolio Health */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Portfolio Health</p>
            <div className="flex items-end gap-2">
              <p className="text-2xl font-bold tabular-nums text-foreground">{clientCount}</p>
              <p className="text-xs text-muted-foreground mb-1">clients</p>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />{growing} growing
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                <span className="w-2 h-2 rounded-full bg-amber-500" />{flat} flat
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500" />{declining} down
              </span>
            </div>
          </Card>

          {/* MTD ROAS */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD ROAS</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {portfolioMtdRoas !== null ? `${portfolioMtdRoas.toFixed(1)}x` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {portfolioMtdRoas !== null
                ? `$${portfolioMtdRoas.toFixed(2)} rev per $1 spent`
                : "Awaiting revenue data"}
            </p>
          </Card>
        </div>
      </div>

      {/* Row 2: Ad Performance */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">Ad Performance</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* MTD Ad Spend */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD Ad Spend</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(totalAdSpend)}</p>
            <div className="flex items-center gap-1.5 mt-2">
              {/* For spend, up is neutral/bad context — keep as-is directional */}
              <StatChange change={totalAdSpendChange} suffix="% MoM" />
            </div>
          </Card>

          {/* Total Leads */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD Leads</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{dashboard.totals.totalLeads.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-2">from Meta campaigns</p>
          </Card>

          {/* Sessions */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD Sessions</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{dashboard.totals.totalSessions.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-2">from Google Analytics</p>
          </Card>

          {/* Cost per Lead */}
          <Card className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Avg Cost / Lead</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {dashboard.totals.totalLeads > 0
                ? formatCurrency(totalAdSpend / dashboard.totals.totalLeads)
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {dashboard.totals.totalLeads > 0 ? `${dashboard.totals.totalLeads} leads MTD` : "No leads recorded"}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
