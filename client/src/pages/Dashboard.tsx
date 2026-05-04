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
    totalSessions: number;
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
    costPerLead: number;
    conversionRate: number;
    history: Array<{ period: string; sessions: number | null; leads: number | null; adSpend: number | null }>;
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
  const growing = dashboard.clients.filter(
    (c) => (c.revenue.ytdChange ?? 0) > 5
  ).length;
  const declining = dashboard.clients.filter(
    (c) => (c.revenue.ytdChange ?? 0) < -5
  ).length;
  const flat = dashboard.clients.length - growing - declining;
  const atRisk = dashboard.clients.filter((c) => c.health?.churnRisk && c.health.churnRisk !== "low").length;
  const needsTouch = dashboard.clients.filter(
    (c) => c.health?.lastTouchDaysAgo !== null && (c.health?.lastTouchDaysAgo ?? 0) > 30
  ).length;

  const momChange = dashboard.totals.mtdRevenueChange;
  const yoyChange = dashboard.totals.ytdRevenueChange;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="health-summary">
      {/* MTD Revenue */}
      <Card className="p-5 bg-card border border-border rounded-lg">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">MTD Revenue</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(dashboard.totals.mtdRevenue)}</p>
        <div className="flex items-center gap-1.5 mt-2">
          {momChange !== null ? (
            <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
              momChange > 0 ? "text-emerald-500" : momChange < 0 ? "text-red-500" : "text-muted-foreground"
            }`}>
              {momChange > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : momChange < 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {momChange > 0 ? "+" : ""}{momChange.toFixed(1)}% MoM
            </span>
          ) : null}
        </div>
      </Card>

      {/* YTD Revenue */}
      <Card className="p-5 bg-card border border-border rounded-lg">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">YTD Revenue</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(dashboard.totals.ytdRevenue)}</p>
        <div className="flex items-center gap-1.5 mt-2">
          {yoyChange !== null ? (
            <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
              yoyChange > 0 ? "text-emerald-500" : yoyChange < 0 ? "text-red-500" : "text-muted-foreground"
            }`}>
              {yoyChange > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : yoyChange < 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {yoyChange > 0 ? "+" : ""}{yoyChange.toFixed(1)}% YoY
            </span>
          ) : null}
        </div>
      </Card>

      {/* Portfolio health */}
      <Card className="p-5 bg-card border border-border rounded-lg">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Portfolio Health</p>
        <div className="flex items-end gap-2">
          <p className="text-2xl font-bold tabular-nums text-foreground">{dashboard.totals.clientCount}</p>
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

      {/* Attention needed */}
      <Card className="p-5 bg-card border border-border rounded-lg">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Needs Attention</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{atRisk}</p>
        <div className="flex flex-col gap-1 mt-2">
          <span className="text-xs text-muted-foreground">
            {atRisk === 0 ? "No churn risk detected" : `${atRisk} client${atRisk !== 1 ? "s" : ""} at churn risk`}
          </span>
          {needsTouch > 0 && (
            <span className="text-xs text-amber-500 font-medium">
              {needsTouch} overdue for touch
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
