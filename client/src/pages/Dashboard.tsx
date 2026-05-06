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

export type DashboardData = {
  totals: {
    mtdSpend: number;
    momChange: number | null;
    yoyChange: number | null;
    ytdSpend: number;
    ytdChange: number | null;
    totalLeads: number;
    totalSessions: number;
    mtdRevenue: number;
    ytdRevenue: number;
    portfolioMtdRoas: number | null;
    portfolioYtdRoas: number | null;
    clientCount: number;
    growing: number;
    flat: number;
    declining: number;
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
  ads: {
    mtdSpend: number;
    momSpend: number;
    momChange: number | null;
    yoySpend: number;
    yoyChange: number | null;
    ytdSpend: number;
    ytdSpendPrior: number;
    ytdChange: number | null;
    mtdLeads: number;
    momLeads: number;
    leadsChange: number | null;
    yoyLeads: number;
    leadsYoyChange: number | null;
    mtdSessions: number;
    mtdRoas: number | null;
    ytdRoas: number | null;
    history: Array<{
      period: string;
      adSpend: number | null;
      adSpendPriorYear: number | null;
      leads: number | null;
      sessions: number | null;
    }>;
  };
  revenue: {
    mtd: number;
    ytd: number;
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
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : dashboard ? (
            <HealthSummaryCards dashboard={dashboard} />
          ) : null}

          {/* Ad Spend Chart */}
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

function StatChange({
  change,
  label,
}: {
  change: number | null | undefined;
  label: string;
}) {
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
        highlight
          ? "bg-primary/5 border-primary/30"
          : "bg-card border-border"
      }`}
    >
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">
        {label}
      </p>
      <div className="text-2xl font-bold tabular-nums text-foreground leading-tight">
        {value}
      </div>
      {sub && <div className="mt-2">{sub}</div>}
    </Card>
  );
}

function HealthSummaryCards({ dashboard }: { dashboard: DashboardData }) {
  const {
    mtdSpend,
    momChange,
    yoyChange,
    ytdSpend,
    ytdChange,
    totalLeads,
    totalSessions,
    mtdRevenue,
    ytdRevenue,
    portfolioMtdRoas,
    clientCount,
    growing,
    flat,
    declining,
  } = dashboard.totals;

  return (
    <div className="space-y-3" data-testid="health-summary">
      {/* Row 1: Ad Performance */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">
          Ad Performance
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* MTD Spend + MoM */}
          <KpiCard
            label="MTD Ad Spend"
            highlight
            value={
              mtdSpend > 0 ? (
                formatCurrency(mtdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<StatChange change={momChange} label="MoM" />}
          />

          {/* YTD Spend + YoY */}
          <KpiCard
            label="YTD Ad Spend"
            highlight
            value={
              ytdSpend > 0 ? (
                formatCurrency(ytdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<StatChange change={ytdChange} label="YoY" />}
          />

          {/* Portfolio Health — growing/flat/declining based on YoY ad spend */}
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

          {/* MTD ROAS */}
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

      {/* Row 2: Supporting metrics + Revenue */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">
          Supporting Metrics
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* MTD Leads */}
          <KpiCard
            label="MTD Leads"
            value={
              totalLeads > 0 ? (
                totalLeads.toLocaleString()
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">from Meta campaigns</span>
            }
          />

          {/* MTD Sessions */}
          <KpiCard
            label="MTD Sessions"
            value={
              totalSessions > 0 ? (
                totalSessions.toLocaleString()
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">from Google Analytics</span>
            }
          />

          {/* Revenue MTD — context only */}
          <KpiCard
            label="Revenue MTD"
            value={
              mtdRevenue > 0 ? (
                formatCurrency(mtdRevenue)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">from ERS / IO / CRM</span>
            }
          />

          {/* Revenue YTD — context only */}
          <KpiCard
            label="Revenue YTD"
            value={
              ytdRevenue > 0 ? (
                formatCurrency(ytdRevenue)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">from ERS / IO / CRM</span>
            }
          />
        </div>
      </div>
    </div>
  );
}
