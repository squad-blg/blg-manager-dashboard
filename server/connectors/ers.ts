/**
 * ERS (Event Rental Systems) connector
 *
 * Uses POST /api/read/order_counts/ to get order count by date,
 * then POST /api/read/customers/ + order reads to sum revenue.
 *
 * Auth: POST body with key (developer key) + token (API token)
 */

import axios from "axios";

export interface ERSMetrics {
  revenue: number;
  orderCount: number;
}

const POST_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

function authBody(devKey: string, apiToken: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ key: devKey, token: apiToken, ...extra });
  return p.toString();
}

/**
 * @param folder     ERS folder subdomain (e.g. "centex")
 * @param apiToken   ERS API Token from Admin > General Config > API Info
 * @param devKey     ERS Developer API Key from Admin > General Config > API Keys
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 */
export async function fetchERSMetrics(
  folder: string,
  apiToken: string,
  devKey: string,
  startDate: string,
  endDate: string
): Promise<ERSMetrics> {
  const base = `https://${folder}.ourers.com`;

  // Step 1: Get order counts by date to know total order count
  const countRes = await axios.post(
    `${base}/api/read/order_counts/`,
    authBody(devKey, apiToken, { start_date: startDate, end_date: endDate }),
    { headers: POST_HEADERS, timeout: 20_000 }
  );

  const countData = countRes.data;
  // Sum all daily order counts
  let orderCount = 0;
  if (countData?.rows && typeof countData.rows === "object") {
    orderCount = Object.values(countData.rows as Record<string, string>)
      .reduce((sum, v) => sum + parseInt(v as string, 10), 0);
  }

  // Step 2: Get revenue via insights report (tries different param combos)
  // ERS insights returns revenue breakdown
  let revenue = 0;

  try {
    const insRes = await axios.post(
      `${base}/api/report/insights/`,
      authBody(devKey, apiToken, { start_date: startDate, end_date: endDate }),
      { headers: POST_HEADERS, timeout: 20_000 }
    );
    const ins = insRes.data;
    if (ins?.data && Array.isArray(ins.data) && ins.data.length > 0) {
      // insights data array — sum revenue fields
      revenue = ins.data.reduce((sum: number, row: any) => {
        return sum + (parseFloat(row.revenue ?? row.total ?? row.gross ?? "0") || 0);
      }, 0);
    }
  } catch {
    // fallback below
  }

  // Step 3: If insights returned nothing, try reading a sample of orders directly
  // Use order_counts paging to get matching_orders count and read page 1
  if (revenue === 0 && countData?.paging?.matching_orders > 0) {
    try {
      // Read customers with recent orders — ERS doesn't have a direct "orders in range" list endpoint
      // but we can use the summary report with no date filter as a last resort
      const summaryRes = await axios.post(
        `${base}/api/report/summary/`,
        authBody(devKey, apiToken),
        { headers: POST_HEADERS, timeout: 20_000 }
      );
      const s = summaryRes.data;
      if (s?.data && Array.isArray(s.data) && s.data.length > 0) {
        revenue = s.data.reduce((sum: number, row: any) => {
          return sum + (parseFloat(row.revenue ?? row.total ?? row.gross ?? "0") || 0);
        }, 0);
      }
    } catch {
      // revenue stays 0 — order count still correct
    }
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount,
  };
}
