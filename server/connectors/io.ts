/**
 * Inflatable Office (IO) connector
 *
 * API reference: https://rental.software/support/knowledge-base/?cat=api
 *
 * Auth:   apiKey as query-string param — NOT a Bearer header
 * Stats:  GET /api6/stats?apiKey=XXXX  with { start, end } Unix timestamps as JSON body
 * Leads:  GET /api6/leads?apiKey=XXXX  with pagination query params
 *
 * Per-client config stored in the clients table:
 *   ioAccountId — not used (all IO accounts share https://rental.software)
 *   ioApiKey    — the API key from IO Admin → Settings → API Keys
 *
 * Rate limit: 300 calls / 300 seconds per key.
 */

import axios from "axios";

export interface IOMetrics {
  revenue: number;      // "Total Sales" from stats — dollar amount
  orderCount: number;   // "Total Events" from stats
  leadCount: number;    // "Total Leads" from stats
}

/**
 * Parse a dollar-formatted string like "$1,234.56" → 1234.56
 * IO returns currency values with dollar signs and commas.
 */
function parseDollar(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return parseFloat(value.replace(/[$,]/g, "")) || 0;
  }
  return 0;
}

/**
 * Parse an integer-formatted string like "42" or 42 → 42
 */
function parseCount(value: unknown): number {
  const n = parseInt(String(value ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Fetch stats from Inflatable Office for a date range.
 *
 * @param baseUrl    Client's IO base URL, e.g. "https://yourcompany.rental.software"
 * @param apiKey     IO API key
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 */
export async function fetchIOMetrics(
  baseUrl: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<IOMetrics> {
  const resolvedBase = "https://rental.software";

  // Convert YYYY-MM-DD → Unix timestamp (start of day UTC)
  const startTs = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000).toString();
  const endTs   = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000).toString();

  // IO stats endpoint: the docs show a JSON body with start/end timestamps.
  // axios.get() silently drops the body, so use axios.request() with method:'get'
  // to force the JSON body through on a GET request.
  const res = await axios.request({
    method: "get",
    url: `${resolvedBase}/api6/stats`,
    params: { apiKey },
    data: { start: startTs, end: endTs },
    headers: { "Content-Type": "application/json" },
    timeout: 20_000,
  });

  const stats: Record<string, string | number> = res.data ?? {};

  const revenue    = parseDollar(stats["Total Sales"]);
  const orderCount = parseCount(stats["Total Events"]);
  const leadCount  = parseCount(stats["Total Leads"]);

  return { revenue, orderCount, leadCount };
}

/**
 * Fetch lead count from IO for a date range via /api6/leads.
 * Uses eventstarttime_ts filter via query params.
 * Returns total count only (no revenue — use fetchIOMetrics for revenue).
 */
export async function fetchIOLeadCount(
  baseUrl: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const resolvedBase = "https://rental.software";

  const startTs = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000).toString();
  const endTs   = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000).toString();

  // Fetch first page with limit=1 just to get total count from pagination metadata
  const res = await axios.get(`${resolvedBase}/api6/leads`, {
    params: { apiKey, limit: 1, offset: 0, start: startTs, end: endTs },
    timeout: 20_000,
  });

  // IO pagination returns total in various shapes — try common ones
  const data = res.data ?? {};
  const total =
    parseCount(data.total) ||
    parseCount(data.count) ||
    (Array.isArray(data.items) ? data.items.length : 0);

  return total;
}
