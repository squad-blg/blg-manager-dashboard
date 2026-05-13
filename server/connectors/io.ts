/**
 * Inflatable Office (IO) connector
 *
 * API reference: https://rental.software/support/knowledge-base/?cat=api
 *
 * Primary endpoint: GET /api6/leads  (stats endpoint requires add-on subscription)
 *   - Auth: apiKey as query-string param
 *   - Date filter: eventstarttime_start / eventstarttime_end as Unix timestamps
 *   - Revenue: sum of `total` field across all leads in the date range
 *   - Pagination: offset/limit, page through all results
 *
 * All IO accounts share https://rental.software — ioAccountId is not used.
 * ioApiKey is the only per-client credential needed.
 *
 * Rate limit: 300 calls / 300 seconds per key.
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;    // sum of lead `total` fields in the date range
  orderCount: number; // number of leads (events) in the date range
  leadCount: number;  // same as orderCount for IO (leads = events)
}

const BASE_URL = "https://rental.software";
const PAGE_SIZE = 100;

/**
 * Fetch all leads for a date range and compute revenue + count.
 * Pages through results automatically (100 per page).
 *
 * @param _baseUrl   Ignored — all IO accounts use rental.software
 * @param apiKey     IO API key from Admin → Settings → API Keys
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 */
export async function fetchIOMetrics(
  _baseUrl: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<IOMetrics> {
  // Convert YYYY-MM-DD → Unix timestamps
  const startTs = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const endTs   = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

  let offset = 0;
  let totalRevenue = 0;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await axios.get(`${BASE_URL}/api6/leads`, {
      params: {
        apiKey,
        limit: PAGE_SIZE,
        offset,
        eventstarttime_start: startTs,
        eventstarttime_end: endTs,
      },
      timeout: 20_000,
    });

    const items: any[] = Array.isArray(res.data?.items) ? res.data.items : [];

    for (const lead of items) {
      const amount = parseFloat(lead.total ?? "0") || 0;
      totalRevenue += amount;
    }

    totalCount += items.length;

    // Stop if we got fewer items than a full page — no more results
    if (items.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  return {
    revenue: Math.round(totalRevenue * 100) / 100,
    orderCount: totalCount,
    leadCount: totalCount,
  };
}
