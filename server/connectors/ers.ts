/**
 * ERS (Event Rental Systems) connector
 *
 * Uses POST /api/read/order_counts/ to get order count by date,
 * then POST /api/report/insights/ (or /api/report/summary/) to sum revenue.
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
 * Attempt to extract a revenue number from an unknown ERS response object.
 * ERS API field names vary across versions and endpoints. We log the full
 * response shape so mismatches can be diagnosed from Railway logs.
 */
function extractRevenue(rows: any[], label: string, folder: string): number {
  if (!rows.length) return 0;

  // Log the first row keys so we can see exactly what ERS is returning
  const sampleKeys = Object.keys(rows[0] ?? {});
  console.log(`[ers:${folder}] ${label} sample keys:`, sampleKeys);
  console.log(`[ers:${folder}] ${label} sample row:`, JSON.stringify(rows[0]).slice(0, 300));

  // Known field names across ERS versions — extend this list as needed
  const REVENUE_FIELDS = [
    "revenue", "total", "gross", "order_total", "subtotal",
    "amount", "grand_total", "total_revenue", "net_revenue",
    "rental_total", "event_total",
  ];

  let revenue = 0;
  for (const row of rows) {
    for (const field of REVENUE_FIELDS) {
      const raw = row[field];
      if (raw !== undefined && raw !== null && raw !== "") {
        const parsed = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
        if (!isNaN(parsed) && parsed > 0) {
          revenue += parsed;
          break;
        }
      }
    }
  }
  return revenue;
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
  console.log(`[ers:${folder}] Fetching ${startDate} to ${endDate}`);

  // Step 1: Order count
  let orderCount = 0;
  let matchingOrders = 0;

  try {
    const countRes = await axios.post(
      `${base}/api/read/order_counts/`,
      authBody(devKey, apiToken, { start_date: startDate, end_date: endDate }),
      { headers: POST_HEADERS, timeout: 20_000 }
    );
    const countData = countRes.data;
    console.log(`[ers:${folder}] order_counts response keys:`, Object.keys(countData ?? {}));

    if (countData?.rows && typeof countData.rows === "object") {
      orderCount = Object.values(countData.rows as Record<string, string>)
        .reduce((sum, v) => sum + (parseInt(v as string, 10) || 0), 0);
    }
    matchingOrders = countData?.paging?.matching_orders ?? orderCount;
    console.log(`[ers:${folder}] orderCount=${orderCount} matchingOrders=${matchingOrders}`);
  } catch (e: any) {
    console.error(`[ers:${folder}] order_counts failed:`, e.message, e.response?.data ?? "");
  }

  // Step 2: Revenue via insights report
  let revenue = 0;

  try {
    const insRes = await axios.post(
      `${base}/api/report/insights/`,
      authBody(devKey, apiToken, { start_date: startDate, end_date: endDate }),
      { headers: POST_HEADERS, timeout: 20_000 }
    );
    const ins = insRes.data;
    console.log(`[ers:${folder}] insights response keys:`, Object.keys(ins ?? {}));

    const rows: any[] = Array.isArray(ins?.data)
      ? ins.data
      : Array.isArray(ins?.rows)
      ? ins.rows
      : Array.isArray(ins)
      ? ins
      : [];

    if (rows.length > 0) {
      revenue = extractRevenue(rows, "insights", folder);
      console.log(`[ers:${folder}] insights revenue=$${revenue} from ${rows.length} rows`);
    } else {
      console.log(`[ers:${folder}] insights returned no rows — trying summary fallback`);
    }
  } catch (e: any) {
    console.error(`[ers:${folder}] insights failed:`, e.message, e.response?.data ?? "");
  }

  // Step 3: Fallback — summary report WITH date range (was missing date params before)
  if (revenue === 0) {
    try {
      const summaryRes = await axios.post(
        `${base}/api/report/summary/`,
        authBody(devKey, apiToken, { start_date: startDate, end_date: endDate }),
        { headers: POST_HEADERS, timeout: 20_000 }
      );
      const s = summaryRes.data;
      console.log(`[ers:${folder}] summary response keys:`, Object.keys(s ?? {}));

      const rows: any[] = Array.isArray(s?.data)
        ? s.data
        : Array.isArray(s?.rows)
        ? s.rows
        : Array.isArray(s)
        ? s
        : [];

      if (rows.length > 0) {
        revenue = extractRevenue(rows, "summary", folder);
        console.log(`[ers:${folder}] summary revenue=$${revenue} from ${rows.length} rows`);
      } else {
        console.log(`[ers:${folder}] summary returned no rows either`);
      }
    } catch (e: any) {
      console.error(`[ers:${folder}] summary failed:`, e.message, e.response?.data ?? "");
    }
  }

  // Step 4: Last resort — read individual orders if reports still return nothing
  if (revenue === 0 && matchingOrders > 0) {
    try {
      console.log(`[ers:${folder}] Attempting order-level read for ${matchingOrders} orders`);
      const ordersRes = await axios.post(
        `${base}/api/read/orders/`,
        authBody(devKey, apiToken, { start_date: startDate, end_date: endDate, num_rows: "500" }),
        { headers: POST_HEADERS, timeout: 30_000 }
      );
      const o = ordersRes.data;
      console.log(`[ers:${folder}] orders response keys:`, Object.keys(o ?? {}));

      const rows: any[] = Array.isArray(o?.data)
        ? o.data
        : Array.isArray(o?.rows)
        ? o.rows
        : Array.isArray(o)
        ? o
        : [];

      if (rows.length > 0) {
        revenue = extractRevenue(rows, "orders", folder);
        console.log(`[ers:${folder}] orders revenue=$${revenue} from ${rows.length} rows`);
      }
    } catch (e: any) {
      console.error(`[ers:${folder}] order read failed:`, e.message, e.response?.data ?? "");
    }
  }

  if (revenue === 0 && orderCount > 0) {
    console.warn(
      `[ers:${folder}] WARNING: orderCount=${orderCount} but revenue=$0 — check logs above for ERS response shape`
    );
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount,
  };
}
