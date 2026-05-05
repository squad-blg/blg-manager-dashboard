/**
 * ERS (Event Rental Systems) connector
 *
 * Revenue = sum of order totals from the summary report
 * Orders  = order count
 *
 * Auth: POST with key (developer key) + token (API token) in request body
 * Endpoint: POST https://{folder}.ourers.com/api/report/summary/
 *
 * Docs: https://{folder}.ourers.com/api6/documentation
 */

import axios from "axios";

export interface ERSMetrics {
  revenue: number;
  orderCount: number;
}

/**
 * @param folder     ERS folder subdomain (e.g. "rockinbounce")
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
  // ERS API uses POST with key + token in the body
  // Use the summary report which includes revenue totals for a date range
  const baseUrl = `https://${folder}.ourers.com`;

  const params = new URLSearchParams({
    key: devKey,
    token: apiToken,
    start_date: startDate,
    end_date: endDate,
  });

  const res = await axios.post(
    `${baseUrl}/api/report/summary/`,
    params.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20_000,
    }
  );

  const data = res.data;

  // ERS summary report returns an object with revenue/order totals
  // Try multiple possible field names based on ERS API response structure
  let revenue = 0;
  let orderCount = 0;

  if (data && typeof data === "object") {
    // Common ERS summary fields
    revenue =
      parseFloat(data.total_revenue ?? data.revenue ?? data.total ?? data.gross ?? "0") || 0;
    orderCount =
      parseInt(data.order_count ?? data.orders ?? data.total_orders ?? "0", 10) || 0;

    // If it's an array of orders, sum them up
    if (Array.isArray(data)) {
      orderCount = data.length;
      revenue = data.reduce(
        (sum: number, o: any) =>
          sum + (parseFloat(o.total ?? o.orderTotal ?? o.order_total ?? "0") || 0),
        0
      );
    }
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount,
  };
}
