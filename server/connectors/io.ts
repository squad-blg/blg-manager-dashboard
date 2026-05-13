/**
 * Inflatable Office (IO) connector
 *
 * Uses GET /api6/stats with Unix timestamp date range to fetch revenue.
 *
 * Base URL: https://rental.software/api6
 * Auth: ?apiKey=YOUR_KEY (query parameter)
 * Revenue field: "Total Sales" (formatted as "$3,238.67")
 *
 * API docs: https://rental.software/support/knowledge-base/article/api-stats-retrieve-list
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;
  totalEvents: number;
  totalLeads: number;
}

const BASE_URL = "https://rental.software/api6";

/**
 * @param apiKey    IO API key from Settings → API Keys
 * @param startDate YYYY-MM-DD
 * @param endDate   YYYY-MM-DD
 */
export async function fetchIOMetrics(
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<IOMetrics> {
  // Convert YYYY-MM-DD to Unix timestamps
  const start = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
  const end = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000);

  console.log(`[io] Fetching stats ${startDate} → ${endDate} (${start} → ${end})`);

  try {
    // IO API requires POST with JSON body for /stats endpoint
    // apiKey goes as query param, date range as JSON body
    const res = await axios.post(
      `${BASE_URL}/stats?apiKey=${encodeURIComponent(apiKey)}`,
      { start: String(start), end: String(end) },
      { headers: { "Content-Type": "application/json" }, timeout: 20_000 }
    );

    const data = res.data;
    console.log(`[io] Stats response keys:`, Object.keys(data ?? {}));
    console.log(`[io] Raw response:`, JSON.stringify(data).slice(0, 400));

    // "Total Sales" comes back as "$3,238.67" — strip formatting
    const rawSales = data?.["Total Sales"] ?? data?.["total_sales"] ?? "0";
    const revenue = parseFloat(String(rawSales).replace(/[^0-9.-]/g, ""));

    const totalEvents = parseInt(String(data?.["Total Events"] ?? "0").replace(/[^0-9]/g, ""), 10);
    const totalLeads = parseInt(String(data?.["Total Leads"] ?? "0").replace(/[^0-9]/g, ""), 10);

    console.log(`[io] revenue=$${revenue} events=${totalEvents} leads=${totalLeads}`);

    return {
      revenue: isNaN(revenue) ? 0 : Math.round(revenue * 100) / 100,
      totalEvents: isNaN(totalEvents) ? 0 : totalEvents,
      totalLeads: isNaN(totalLeads) ? 0 : totalLeads,
    };
  } catch (e: any) {
    console.error(`[io] Stats fetch failed:`, e.message, e.response?.data ?? "");
    return { revenue: 0, totalEvents: 0, totalLeads: 0 };
  }
}
