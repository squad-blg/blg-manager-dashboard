import { useState } from "react";
import { Link } from "wouter";
import { Sparkles, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  estimateRevenue,
  type EstimatorBreakdown,
  type Vertical,
} from "@/lib/revenueEstimator";

/**
 * EstimatedRevenueCard
 *
 * Drop-in fallback for the REVENUE MTD / REVENUE YTD slots when a client (or
 * portfolio of clients) has never connected a CRM. Matches the local `KpiCard`
 * primitive used throughout Dashboard.tsx but with three visual differentiators
 * agreed in spec:
 *
 *   1. Dashed border in the primary brand color.
 *   2. Amber "Estimated" pill in the top-right corner.
 *   3. Inline CTA -> /clients (the page where credentials are configured).
 *
 * The component intentionally does NOT hide the number behind a blur — the
 * agency's DMMs need a directional revenue figure during onboarding to spot
 * obviously broken accounts. The dashed border + badge + tooltip make the
 * "this is a model, not your ledger" signal unambiguous.
 */

export interface EstimatedRevenueCardProps {
  label: string;                 // "Revenue MTD" | "Revenue YTD"
  paidClicks?: number;
  seoSessions?: number;
  paidLeads?: number;
  vertical: Vertical;
  /** Where the CTA should link to. Defaults to /clients. */
  configureHref?: string;
}

export function EstimatedRevenueCard({
  label,
  paidClicks,
  seoSessions,
  paidLeads,
  vertical,
  configureHref = "/clients",
}: EstimatedRevenueCardProps) {
  const breakdown = estimateRevenue({
    paidClicks,
    seoSessions,
    paidLeads,
    vertical,
  });

  return (
    <Card
      className="relative p-5 rounded-lg border border-dashed border-primary/40 bg-primary/[0.03]"
      data-testid="card-estimated-revenue"
      aria-label={`${label} (estimated)`}
    >
      <EstimatedBadge confidence={breakdown.confidence} />

      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">
        {label}
      </p>

      <div className="text-2xl font-bold tabular-nums text-foreground leading-tight flex items-baseline gap-1.5">
        <span aria-hidden="true" className="text-muted-foreground/60 text-lg font-normal">~</span>
        {formatCurrency(breakdown.estimatedRevenue)}
      </div>

      <FormulaTooltip breakdown={breakdown} />

      <Link href={configureHref}>
        <a
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          data-testid="link-connect-crm"
        >
          Connect CRM to view real revenue
          <ArrowRight className="w-3 h-3" />
        </a>
      </Link>
    </Card>
  );
}

// ---------- subcomponents ----------

function EstimatedBadge({ confidence }: { confidence: EstimatorBreakdown["confidence"] }) {
  // Amber regardless of confidence — we never want this to read as "verified".
  // Confidence only affects the tooltip copy.
  return (
    <span
      className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      data-testid="badge-estimated"
    >
      <Sparkles className="w-3 h-3" />
      Estimated
    </span>
  );
}

function FormulaTooltip({ breakdown }: { breakdown: EstimatorBreakdown }) {
  const [show, setShow] = useState(false);
  const confidenceCopy = {
    high: "Based on measured paid leads and organic sessions.",
    medium: "Based on modelled paid traffic and organic sessions.",
    low: "Only partial traffic data available — directional only.",
  }[breakdown.confidence];

  return (
    <span
      className="relative inline-block cursor-help mt-1"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      tabIndex={0}
    >
      <span className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2">
        How is this calculated?
      </span>
      {show && (
        <span className="absolute z-50 bottom-full left-0 mb-2 w-72 bg-popover border border-border rounded-lg shadow-lg p-3 text-xs text-popover-foreground">
          <span className="font-semibold block mb-1.5">Estimated revenue formula</span>
          <span className="block text-muted-foreground leading-relaxed mb-2">
            {breakdown.formula}
          </span>
          <span className="block mb-1">
            Paid contribution: <strong>{formatCurrency(breakdown.paidRevenue)}</strong>
          </span>
          <span className="block mb-2">
            Organic contribution: <strong>{formatCurrency(breakdown.organicRevenue)}</strong>
          </span>
          <span className="block text-muted-foreground border-t border-border pt-1.5">
            {confidenceCopy} Connect CRM for actuals.
          </span>
        </span>
      )}
    </span>
  );
}

// Local copy of the dashboard's currency formatter so this component is
// self-contained. Replace with the shared util if you have one.
function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
