/**
 * revenueEstimator.ts
 *
 * Proxy-revenue calculator for clients whose CRM has never been connected.
 *
 * The formula splits traffic into two independent streams because paid and
 * organic visitors convert very differently. A single blended CR systematically
 * over- or under-counts depending on the mix.
 *
 *   Proxy Revenue
 *     = (Paid Clicks   x Paid CR    x Paid AOV)
 *     + (SEO Sessions  x Organic CR x Organic AOV)
 *
 * When `paid leads` are already known (Meta lead-gen forms, Google conversions),
 * we prefer them over `clicks x CR` because they are a measured conversion
 * rather than a modelled one. The substitution is:
 *
 *     Paid Revenue = Paid Leads x Lead Close Rate x Paid AOV
 *
 * Defaults are keyed on `platform` (ERS, IO, ECOMM, LEADGEN) since the repo has
 * no `industry` column yet. If/when an `industry` field is added, pass it via
 * `overrides` and it will take precedence.
 *
 * NOTHING in this file talks to the network. It is pure and unit-testable.
 */

export type Vertical = "ERS" | "IO" | "ECOMM" | "LEADGEN";

export interface VerticalDefaults {
  /** Paid-traffic conversion rate (clicks -> lead OR clicks -> sale). 0..1 */
  paidCR: number;
  /** Organic conversion rate (sessions -> sale OR sessions -> lead). 0..1 */
  organicCR: number;
  /** Lead-to-customer close rate. Used when we already have measured leads. 0..1 */
  leadCloseRate: number;
  /** Average order value, USD. */
  aov: number;
}

/**
 * Industry benchmark table.
 *
 * Sources / sanity checks:
 *  - WordStream search-ads benchmarks 2024 (paid CR median ~3-7% across SMB verticals).
 *  - Unbounce conversion benchmark report 2024 (lead-gen forms 2-10%).
 *  - Shopify ecommerce benchmark 2024 (typical CR 1.5-3.5%, AOV varies wildly).
 *  - For ERS / IO (party-rental / inflatable office) we use the agency's empirical
 *    close rates: ~25-35% lead-to-booking, AOV in the $300-500 range.
 *
 * These are starting points. They should be tunable in Settings.
 */
export const VERTICAL_DEFAULTS: Record<Vertical, VerticalDefaults> = {
  // Event Rental Systems (party/event rentals, large bookings, phone-heavy)
  ERS: {
    paidCR: 0.05,        // clicks -> form fill on rental landers
    organicCR: 0.008,    // long browse sessions, lower direct conversion
    leadCloseRate: 0.30, // ~30% of leads become bookings
    aov: 450,            // average rental ticket
  },
  // Inflatable Office (party rentals via IO platform — similar economics to ERS)
  IO: {
    paidCR: 0.05,
    organicCR: 0.008,
    leadCloseRate: 0.30,
    aov: 400,
  },
  // Generic ecommerce (Shopify/WooCommerce). Direct purchase, no human in loop.
  ECOMM: {
    paidCR: 0.022,
    organicCR: 0.015,
    leadCloseRate: 1.0,  // every "lead" IS a purchase
    aov: 75,
  },
  // Pure lead-gen (B2B, services). High AOV but conversion is many-step.
  LEADGEN: {
    paidCR: 0.04,
    organicCR: 0.012,
    leadCloseRate: 0.20,
    aov: 1200,
  },
};

export interface EstimatorInput {
  /** Total clicks from Google Ads + Meta Ads in the period. */
  paidClicks?: number;
  /** Organic / SEO sessions in the period (GA4). */
  seoSessions?: number;
  /**
   * Measured paid leads in the period (Meta lead-gen forms, Google conversions).
   * When provided, we use Leads x Close Rate x AOV instead of Clicks x CR x AOV
   * for the paid stream — it removes one layer of modelling.
   */
  paidLeads?: number;
  /** Which vertical/platform defaults to apply. */
  vertical: Vertical;
  /** Per-call overrides for any of the default coefficients. */
  overrides?: Partial<VerticalDefaults>;
}

export interface EstimatorBreakdown {
  /** The final proxy revenue, rounded to cents. */
  estimatedRevenue: number;
  /** Revenue attributable to the paid stream. */
  paidRevenue: number;
  /** Revenue attributable to the organic stream. */
  organicRevenue: number;
  /** Coefficients actually used (after overrides). Surface in tooltip for trust. */
  coefficientsUsed: VerticalDefaults;
  /**
   * Confidence tier. Used to decide how prominently to display the number.
   *  - "high":   we used measured paid leads + non-trivial organic sessions.
   *  - "medium": we used modelled paid clicks OR only one of the two streams.
   *  - "low":    one of the streams is zero/missing — number is a partial estimate.
   */
  confidence: "high" | "medium" | "low";
  /** Human-readable formula trace for the tooltip. */
  formula: string;
}

/**
 * Estimate revenue for a single client/period.
 *
 * All multiplications are guarded against undefined/NaN; missing inputs are
 * treated as zero so the function never throws on a partial payload.
 */
export function estimateRevenue(input: EstimatorInput): EstimatorBreakdown {
  const base = VERTICAL_DEFAULTS[input.vertical];
  const coef: VerticalDefaults = { ...base, ...(input.overrides ?? {}) };

  const paidClicks = safe(input.paidClicks);
  const seoSessions = safe(input.seoSessions);
  const paidLeads = safe(input.paidLeads);

  let paidRevenue = 0;
  let paidTrace = "";

  if (paidLeads > 0) {
    paidRevenue = paidLeads * coef.leadCloseRate * coef.aov;
    paidTrace = `${paidLeads} leads x ${pct(coef.leadCloseRate)} close x ${money(coef.aov)} AOV`;
  } else if (paidClicks > 0) {
    paidRevenue = paidClicks * coef.paidCR * coef.aov;
    paidTrace = `${paidClicks} clicks x ${pct(coef.paidCR)} CR x ${money(coef.aov)} AOV`;
  }

  const organicRevenue = seoSessions * coef.organicCR * coef.aov;
  const organicTrace =
    seoSessions > 0
      ? `${seoSessions} sessions x ${pct(coef.organicCR)} CR x ${money(coef.aov)} AOV`
      : "";

  const estimatedRevenue = round2(paidRevenue + organicRevenue);

  const confidence: EstimatorBreakdown["confidence"] =
    paidLeads > 0 && seoSessions > 0
      ? "high"
      : paidRevenue > 0 && organicRevenue > 0
      ? "medium"
      : "low";

  const formula =
    [paidTrace && `Paid: ${paidTrace}`, organicTrace && `Organic: ${organicTrace}`]
      .filter(Boolean)
      .join("  +  ") || "No traffic data available";

  return {
    estimatedRevenue,
    paidRevenue: round2(paidRevenue),
    organicRevenue: round2(organicRevenue),
    coefficientsUsed: coef,
    confidence,
    formula,
  };
}

// ---------- small helpers ----------

function safe(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function money(n: number): string {
  return `$${n.toFixed(0)}`;
}
