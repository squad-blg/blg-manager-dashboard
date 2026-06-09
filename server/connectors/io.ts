/**
 * Inflatable Office (IO) connector
 *
 * Revenue source: GET /api6/leads/ — paginates all leads in the date window,
 * filters by event date client-side, sums the `total` field across non-cancelled bookings.
 *
 * NOTE: /api6/stats was previously used as the primary source, but it does NOT
 * reliably filter by date range. For several accounts it returns cumulative all-time
 * totals regardless of the start/end params, causing June-9 revenue to appear
 * equal to a full month of May. The leads endpoint is the only accurate source.
 *
 * Base URL: https://rental.software/api6
 * Auth: ?apiKey=YOUR_KEY (query parameter)
 *
 * API docs: https://rental.software/support/knowledge-base/article/api-leads-list
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;
  totalEvents: number;
  totalLeads: number;
}

const BASE_URL = "https://rental.software/api6";

/**
 * Status names that should NOT be counted toward revenue.
 * Note: lead.status is an object { id, name, isactive, ... } — compare against status.name.
 * We also skip any status where isactive === "0" (e.g. "Temporary" / "Quote" / "Cancelled").
 */
const SKIP_STATUS_NAMES = new Set(["cancelled", "canceled", "void", "declined", "quote", "inquiry"]);

/**
 * Paginates /api6/leads/, filters by event date, and sums the `total` field.
 * Passes start/end Unix timestamps — IO may support them even if undocumented;
 * manual date filtering is always applied per lead as a safety net.
 */
async function fetchIOLeadsRevenue(
  apiKey: string,
  startDate: string,
  endDate: string,
  locationId?: string | null
): Promise<{ revenue: number; orderCount: number }> {
  const startTs = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
  const endTs   = Math.floor(new Date(endDate   + "T23:59:59Z").getTime() / 1000);

  let offset = 0;
  const limit = 100;
  let totalRevenue = 0;
  let orderCount = 0;
  const MAX_PAGES = 20; // safety cap — up to 2 000 leads

  console.log(`[io] Leads ${startDate} → ${endDate}`);

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string | number> = {
      apiKey,
      offset,
      limit,
      _body: "true",
      // Pass Unix range — IO may honour these even though undocumented on this endpoint
      start: startTs,
      end:   endTs,
    };
    if (locationId) params.locationid = locationId;

    let leads: any[];
    try {
      const res = await axios.get(`${BASE_URL}/leads/`, { params, timeout: 20_000 });
      const body = res.data;
      leads = Array.isArray(body) ? body : (body?.items ?? body?.leads ?? []);
    } catch (e: any) {
      console.error(`[io] Leads page ${page} failed:`, e.message, e.response?.data ?? "");
      break;
    }

    if (leads.length === 0) break;

    for (const lead of leads) {
      // IO lead.status is an object: { id, name, isactive, color, ... }
      // Skip leads whose status is inactive (isactive === "0") — covers "Temporary",
      // "Quote", draft states, etc. Also skip explicitly named non-revenue statuses.
      const statusObj  = lead.status && typeof lead.status === "object" ? lead.status : null;
      const statusName = String(statusObj?.name ?? lead.status ?? "").toLowerCase();
      const isActive   = statusObj ? String(statusObj.isactive) !== "0" : true;
      if (!isActive || SKIP_STATUS_NAMES.has(statusName)) continue;

      // IO event date field is "eventstarttime" (ISO string or Unix timestamp).
      // Falls back to fullstart, then createtime. If no date is found, skip the lead
      // rather than counting it unconditionally.
      const rawDate = lead.eventstarttime ?? lead.fullstart ?? lead.createtime;
      if (!rawDate) continue; // no date → can't filter → skip to avoid garbage data

      const leadTs =
        typeof rawDate === "number"
          ? rawDate
          : Math.floor(new Date(rawDate).getTime() / 1000);
      if (leadTs < startTs || leadTs > endTs) continue;

      const total = parseFloat(
        String(lead.total ?? lead.grandtotal ?? "0").replace(/[^0-9.-]/g, "")
      );
      if (!isNaN(total) && total > 0) {
        totalRevenue += total;
        orderCount++;
      }
    }

    if (leads.length < limit) break; // last page
    offset += limit;
  }

  console.log(`[io] Leads: revenue=$${totalRevenue.toFixed(2)} orders=${orderCount}`);
  return { revenue: Math.round(totalRevenue * 100) / 100, orderCount };
}

/**
 * @param apiKey     IO API key from Settings → API Keys
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 * @param locationId Optional — required for multi-location IO accounts.
 *                   Find it in IO: Warehouse → Addresses → open the location → last number in URL.
 */
export async function fetchIOMetrics(
  apiKey: string,
  startDate: string,
  endDate: string,
  locationId?: string | null
): Promise<IOMetrics> {
  const locationSuffix = locationId ? ` (location ${locationId})` : "";
  console.log(`[io] Fetching ${startDate} → ${endDate} via leads${locationSuffix}`);

  // Always use the leads endpoint for revenue.
  //
  // The /api6/stats endpoint does NOT reliably filter by date range — it returns
  // cumulative all-time totals for some accounts regardless of start/end params.
  // Confirmed: on June 9, Acadiana ($669K), Blue Line ($717K), Happily Ever After
  // ($594K), and Jump High Jumpers ($435K) each showed June ≈ May (ratio ~1.00),
  // which is impossible for 9 days vs a full month.
  //
  // The leads endpoint applies per-lead event-date filtering and is the only
  // accurate source for date-bounded revenue.
  const result = await fetchIOLeadsRevenue(apiKey, startDate, endDate, locationId);

  return {
    revenue:     result.revenue,
    totalEvents: result.orderCount,
    totalLeads:  0,
  };
}
