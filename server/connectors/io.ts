/**
 * Inflatable Office (IO) connector — STUB
 *
 * IO's API is not yet publicly documented. This stub is wired into the
 * fetch router so activation requires only:
 *   1. Filling in the real base URL and auth header below
 *   2. Mapping the response fields to IOMetrics
 *
 * Per-client: store ioAccountId + ioApiKey in the clients table.
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;
  orderCount: number;
}

/**
 * @param accountId  IO account/location ID
 * @param apiKey     IO API key
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 */
export async function fetchIOMetrics(
  accountId: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<IOMetrics> {
  // ── TODO: Replace with real IO API endpoint when documented ──────────────
  const IO_BASE_URL = process.env.IO_API_BASE_URL ?? "https://api.inflatableoffice.com";

  const res = await axios.get(`${IO_BASE_URL}/v1/orders`, {
    params: { accountId, startDate, endDate },
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 20_000,
  });

  const orders: any[] = Array.isArray(res.data?.orders ?? res.data) ? (res.data?.orders ?? res.data) : [];
  const revenue = orders.reduce(
    (sum, o) => sum + (parseFloat(o.total ?? o.amount ?? "0") || 0),
    0
  );

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount: orders.length,
  };
}
