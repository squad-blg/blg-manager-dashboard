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
  adSpend: number;
  adSpendPrior?: number;
  adSpendChange?: number | null;
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

/** Normalise whichever shape the server sends */
export function getAdMetrics(c: ClientSummary): AdMetrics {
  if (c.analytics) return c.analytics;
  if (c.ads) {
    // ads shape uses mtdSpend instead of adSpend
    return {
      ...c.ads,
      adSpend: c.ads.adSpend ?? c.ads.mtdSpend ?? 0,
      adSpendChange: c.ads.adSpendChange ?? c.ads.momChange ?? null,
    };
  }
  return { adSpend: 0, history: [] };
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

  // Derive portfolio health counts from ad spend change per client
  const growing = dashboard?.clients.filter(
    (c) => (getAdMetrics(c).adSpendChange ?? 0) > 5
  ).length ?? 0;
  const declining = dashboard?.clients.filter(
    (c) => (getAdMetrics(c).adSpendChange ?? 0) < -5
  ).length ?? 0;
  const flat = (dashboard?.totals.clientCount ?? 0) - growing - declining;

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
          ) : dashboard ? (
            <HealthSummaryCards
              dashboard={dashboard}
              growing={growing}
              flat={flat}
              declining={declining}
            />
          ) : null}

          {dashboard && dashboard.clients.length > 0 && (
            <RevenueChart clients={dashboard.clients} />
          )}

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

  // YTD spend: sum analytics history for current year across all clients
  const currentYear = String(new Date().getFullYear());
  const ytdAdSpend = dashboard.clients.reduce((sum, c) => {
    const ytd = (getAdMetrics(c).history ?? [])
      .filter((h) => typeof h.period === "string" && h.period.startsWith(currentYear))
      .reduce((s, h) => s + (h.adSpend ?? 0), 0);
    return sum + ytd;
  }, 0);

  return (
    <div className="space-y-3" data-testid="health-summary">
      {/* Row 1 — Ad Performance */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">
          Ad Performance
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="MTD Ad Spend"
            highlight
            value={
              totalAdSpend > 0 ? (
                formatCurrency(totalAdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={<StatChange change={totalAdSpendChange} label="MoM" />}
          />

          <KpiCard
            label="YTD Ad Spend"
            highlight
            value={
              ytdAdSpend > 0 ? (
                formatCurrency(ytdAdSpend)
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={
              <span className="text-xs text-muted-foreground">Jan–now, current year</span>
            }
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
