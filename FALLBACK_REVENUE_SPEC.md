# Estimated Revenue — Fallback Spec

**Repo:** `squad-blg/blg-manager-dashboard`
**Target surface:** `client/src/pages/Dashboard.tsx`, Revenue MTD / Revenue YTD KPI cards
**Status:** Drop-in. Three new files + one diff to `Dashboard.tsx`. No DB migration required.

---

## 1. Problem

When a client has never connected a CRM (ERS / Inflatable Office / Sheets), the `REVENUE MTD` and `REVENUE YTD` slots currently render `—` with an `Awaiting revenue data` sub-line (see `Dashboard.tsx:678` and `:692`). For DMMs onboarding a brand-new client whose ad data is flowing in but whose CRM credentials are still pending, the dashboard reads as "broken" — even though we already have Google Ads, Meta Ads, and GA4 data live for that client.

The fix is to replace the empty slot with an **explicitly-labelled estimated revenue card** computed from the traffic we do have. The card must look different enough from the real-revenue card that nobody confuses the two, and must always carry a CTA to connect the CRM.

## 2. Estimation logic (proxy formula)

We split traffic into two streams because paid and organic visitors convert very differently — a single blended CR systematically biases the number toward whichever stream dominates volume.

```
Proxy Revenue = (Paid Clicks   × Paid CR    × Paid AOV)
              + (SEO Sessions  × Organic CR × Organic AOV)
```

When measured paid **leads** are already available (Meta lead-gen forms, Google conversions), we substitute the paid term with a measured quantity, removing one layer of modelling:

```
Paid Revenue (preferred) = Paid Leads × Lead Close Rate × Paid AOV
```

The organic term is unchanged.

### Vertical defaults

The repo has no `industry` column on `clients`. We key defaults on the existing `platform` enum (`ERS | IO | ECOMM | LEADGEN`) instead. These values live in `VERTICAL_DEFAULTS` in `client/src/lib/revenueEstimator.ts` and should be tunable later via Settings.

| Vertical | Paid CR | Organic CR | Lead Close Rate | AOV (USD) |
| --- | --- | --- | --- | --- |
| **ERS** (event/party rentals) | 5.0% | 0.8% | 30% | $450 |
| **IO** (Inflatable Office) | 5.0% | 0.8% | 30% | $400 |
| **ECOMM** (Shopify/Woo) | 2.2% | 1.5% | 100% | $75 |
| **LEADGEN** (B2B, services) | 4.0% | 1.2% | 20% | $1,200 |

Sources / sanity references: WordStream search-ads benchmarks 2024, Unbounce conversion benchmark 2024, Shopify ecommerce benchmark 2024, plus the agency's empirical lead-to-booking close rates for party-rental clients.

### Conservative-by-design

The defaults are deliberately on the low side. Sanity check against an active client whose CRM IS connected:

| Client | Real MTD revenue | Modeled MTD (ERS defaults) | Direction |
| --- | --- | --- | --- |
| Big Wave Party Rentals | $82,033 | $8,485 | Estimator under-shoots ~10× |

This is the **correct** failure mode for an onboarding fallback. We never want the estimated number to read as close to the real number — otherwise users will trust it as actuals. Under-shooting + the dashed border + the "Estimated" badge + the CTA make the message "this is a placeholder, plug in your CRM" unambiguous.

### Confidence tiers

The estimator returns a `confidence` flag:

- **high** — measured paid leads + organic sessions > 0. The paid half is a measured conversion, not a modelled one.
- **medium** — both streams non-zero but the paid half is modelled from clicks.
- **low** — only one stream has data. Tooltip copy shifts to "directional only".

## 3. UX spec — the card

The agreed treatment is **dashed border + amber "Estimated" pill**. Visual differentiators from the standard `KpiCard`:

1. **Dashed border** in `border-primary/40 border-dashed` — same brand green as the existing highlighted card, but visually clearly "not a normal card".
2. **Amber `Estimated` pill** in the top-right corner with a `Sparkles` icon, `bg-amber-500/15 text-amber-700`. Amber regardless of confidence — confidence affects tooltip copy, not the badge color.
3. **Number prefixed with `~`** in a muted weight so the eye sees "approximately" before reading the figure.
4. **Inline link CTA** under the number: `Connect CRM to view real revenue →` linking to `/clients`. Uses `text-primary`, no button chrome — matches the existing dashboard's flat link aesthetic.
5. **"How is this calculated?" tooltip** with dotted underline. On hover/focus, expands into a popover showing the literal formula trace, paid vs organic split, confidence-tier copy, and a repeat of the CTA. The tooltip pattern matches `NaTooltip` (`Dashboard.tsx:454`).

### Accessibility

- The card sets `aria-label="Revenue MTD (estimated)"` so screen readers announce the estimated state.
- The badge has `data-testid="badge-estimated"` for E2E coverage.
- The tooltip trigger is focusable (`tabIndex={0}`) so keyboard users can read the formula.
- Color is never the only carrier of meaning — the badge text says "Estimated" and the `~` prefix is repeated in the number.

## 4. Conditional render — switch-case pattern

For a single-client view, use the canonical structured pattern:

```tsx
switch (revenueDisplayMode(client)) {
  case "real":      return <KpiCard label="Revenue MTD" value={formatCurrency(client.revenue.mtd)} />;
  case "estimated": return <EstimatedRevenueCard label="Revenue MTD" {...adsInputs} vertical={vertical} />;
  case "empty":     return <KpiCard label="Revenue MTD" value={<span className="text-muted-foreground">—</span>} />;
}
```

For the portfolio view, the conditional is at the cohort level: only render the estimated card when **100%** of clients in the current filter have no CRM. Mixed cohorts fall back to the existing real-revenue path because we can't honestly aggregate a real number with a modelled one.

## 5. Where the defaults should live longer-term

`VERTICAL_DEFAULTS` is hard-coded for now. Suggested follow-up:

1. Add an `estimator_defaults` table keyed on `vertical` (varchar) with all four coefficients as columns.
2. Surface it under `Settings → Estimator Defaults` so DMMs can tune per-vertical CR/AOV as they accumulate real CRM data.
3. Optional: add an `industry` enum to `clients` (separate from `platform`) and key the lookup on `industry`-first, falling back to `platform` when unset.

None of this is required to ship — the estimator works with the hard-coded table on day one.

## 6. Test ideas

```ts
test("ECOMM uses clicks formula when no leads", () => {
  const r = estimateRevenue({ paidClicks: 1000, seoSessions: 500, vertical: "ECOMM" });
  expect(r.estimatedRevenue).toBeCloseTo(2212.5);
});

test("Prefers measured leads over modelled clicks", () => {
  const r = estimateRevenue({ paidClicks: 1000, paidLeads: 10, vertical: "ERS" });
  expect(r.paidRevenue).toBe(1350);
});

test("Zero traffic returns zero, no throw", () => {
  expect(() => estimateRevenue({ vertical: "LEADGEN" })).not.toThrow();
});
```

## 7. Out of scope (deliberately)

- **CRM partial-state** — CRM is connected but returned zero revenue. The `revenueDisplayMode()` helper returns `"empty"` for this, which renders the existing em-dash. We do NOT estimate over a connected CRM, ever.
- **Currency localization** — the estimator currently uses USD.
- **Persisting the modelled number** — nothing is written back to `revenue_snapshots`. If you ever want to chart "estimated history", add a separate `estimated_revenue_snapshots` table; do not pollute the real table.
