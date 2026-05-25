/**
 * Inflatable Office (IO) connector
 *
 * Primary:  GET /api6/stats  — requires "Overview Stats Full Access" subscription feature.
 * Fallback: GET /api6/leads/ — requires only "Leads" permission; sums the `total` field
 *           across all non-cancelled bookings in the date range.
 *
 * Base URL: https://rental.software/api6
 * Auth: ?apiKey=YOUR_KEY (query parameter)
 *
 * API docs: https://rental.software/support/knowledge-base/article/api-stats-retrieve-list
 *           https://rental.software/support/knowledge-base/article/api-leads-list
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;
  totalEvents: number;
  totalLeads: number;
}

const BASE_URL = "https://rental.software/api6";

/** Statuses that should NOT be counted toward revenue */
const SKIP_STATUSES = new Set(["cancelled", "canceled", "void", "declined"]);

/**
 * Fallback when /api6/stats returns 403.
 * Paginates /api6/leads/, filters by event date, and sums the `total` field.
 * Passes start/end Unix timestamps — IO may support them even if undocumented;
 * if not, manual date filtering is applied per lead.
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

  console.log(`[io] Leads fallback ${startDate} → ${endDate}`);

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
      // Skip non-revenue statuses
      const status = String(lead.status ?? "").toLowerCase();
      if (SKIP_STATUSES.has(status)) continue;

      // Resolve event date → Unix timestamp for manual range check
      const rawDate = lead.startdate ?? lead.eventdate ?? lead.date ?? lead.created;
      if (rawDate) {
        const leadTs =
          typeof rawDate === "number"
            ? rawDate
            : Math.floor(new Date(rawDate).getTime() / 1000);
        if (leadTs < startTs || leadTs > endTs) continue;
      }

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

  console.log(`[io] Leads fallback: revenue=$${totalRevenue.toFixed(2)} orders=${orderCount}`);
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
  // Convert YYYY-MM-DD to Unix timestamps
  const start = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
  const end   = Math.floor(new Date(endDate   + "T23:59:59Z").getTime() / 1000);

  const locationSuffix = locationId ? ` (location ${locationId})` : "";
  console.log(`[io] Fetching stats ${startDate} → ${endDate} (${start} → ${end})${locationSuffix}`);

  const params: Record<string, string> = {
    apiKey,
    start: String(start),
    end:   String(end),
  };
  if (locationId) params.locationid = locationId;

  try {
    const res = await axios.get(`${BASE_URL}/stats`, { params, timeout: 20_000 });

    const data = res.data;
    console.log(`[io] Stats response keys:`, Object.keys(data ?? {}));
    console.log(`[io] Raw response:`, JSON.stringify(data).slice(0, 400));

    // "Total Sales" comes back as "$3,238.67" — strip formatting
    const rawSales = data?.["Total Sales"] ?? data?.["total_sales"] ?? "0";
    const revenue = parseFloat(String(rawSales).replace(/[^0-9.-]/g, ""));

    const totalEvents = parseInt(String(data?.["Total Events"] ?? "0").replace(/[^0-9]/g, ""), 10);
    const totalLeads  = parseInt(String(data?.["Total Leads"]  ?? "0").replace(/[^0-9]/g, ""), 10);

    console.log(`[io] revenue=$${revenue} events=${totalEvents} leads=${totalLeads}`);

    return {
      revenue:     isNaN(revenue)      ? 0 : Math.round(revenue * 100) / 100,
      totalEvents: isNaN(totalEvents)  ? 0 : totalEvents,
      totalLeads:  isNaN(totalLeads)   ? 0 : totalLeads,
    };
  } catch (e: any) {
    // 403 = "Overview Stats Full Access Required" — subscription feature not enabled.
    // Fall back to summing lead totals from /api6/leads/.
    if (e.response?.status === 403) {
      console.warn(`[io] Stats 403 (Overview Stats not enabled) — falling back to Leads endpoint`);
      const fallback = await fetchIOLeadsRevenue(apiKey, startDate, endDate, locationId);
      return {
        revenue:     fallback.revenue,
        totalEvents: fallback.orderCount,
        totalLeads:  0,
      };
    }

    console.error(`[io] Stats fetch failed:`, e.message, e.response?.data ?? "");
    return { revenue: 0, totalEvents: 0, totalLeads: 0 };
  }
}
