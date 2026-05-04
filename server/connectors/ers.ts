/**
 * ERS (Event Rental Systems) connector
 *
 * Revenue = sum of order totals
 * Orders  = order count
 *
 * Each client has their own subdomain and API key stored in the clients table.
 * Endpoint: https://{folder}.ourers.com/api6/orders?apiKey={key}&startDate=&endDate=
 */

import axios from "axios";

export interface ERSMetrics {
  revenue: number;
  orderCount: number;
}

/**
 * @param folder     ERS folder subdomain (e.g. "rockinbounce")
 * @param apiKey     ERS API key from Admin > API Info
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 */
export async function fetchERSMetrics(
  folder: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<ERSMetrics> {
  const url = `https://${folder}.ourers.com/api6/orders`;
  const res = await axios.get(url, {
    params: { apiKey, startDate, endDate },
    timeout: 20_000,
  });

  const orders: any[] = Array.isArray(res.data) ? res.data : [];
  const revenue = orders.reduce(
    (sum, o) => sum + (parseFloat(o.total ?? o.orderTotal ?? "0") || 0),
    0
  );

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount: orders.length,
  };
}
