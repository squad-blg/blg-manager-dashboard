/**
 * Google Ads + GA4 connector
 *
 * Revenue = Google Ads conversion value (all conversions)
 * Ad Spend = Google Ads cost
 * Sessions  = GA4 sessions metric
 *
 * Auth: OAuth2 using a long-lived refresh token.
 * The access token is refreshed automatically and cached in memory.
 */

import axios from "axios";

// ─── Token cache ──────────────────────────────────────────────────────────────
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
  const res = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  cachedAccessToken = res.data.access_token;
  tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
  return cachedAccessToken!;
}

// ─── Google Ads ───────────────────────────────────────────────────────────────
// Returns { revenue (conversion value), adSpend, conversions } for a given period
export interface GoogleAdsMetrics {
  revenue: number;       // sum of conversion_value
  adSpend: number;       // sum of cost_micros / 1e6
  conversions: number;
}

/**
 * @param customerId  Google Ads Customer ID, digits only (no dashes)
 * @param managerCustomerId  MCC customer ID (digits only) — the agency manager account
 * @param startDate   YYYY-MM-DD
 * @param endDate     YYYY-MM-DD
 */
export async function fetchGoogleAdsMetrics(
  accessToken: string,
  customerId: string,
  managerCustomerId: string,
  startDate: string,
  endDate: string
): Promise<GoogleAdsMetrics> {
  // Google Ads Query Language (GAQL)
  const query = `
    SELECT
      metrics.conversions_value,
      metrics.cost_micros,
      metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const url = `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`;
  const res = await axios.post(
    url,
    { query },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
        "login-customer-id": managerCustomerId,
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    }
  );

  // searchStream returns an array of result batches
  let revenue = 0, adSpend = 0, conversions = 0;
  for (const batch of res.data ?? []) {
    for (const row of batch.results ?? []) {
      revenue    += parseFloat(row.metrics?.conversionsValue ?? "0");
      adSpend    += parseInt(row.metrics?.costMicros ?? "0", 10) / 1_000_000;
      conversions += parseFloat(row.metrics?.conversions ?? "0");
    }
  }
  return {
    revenue: Math.round(revenue * 100) / 100,
    adSpend: Math.round(adSpend * 100) / 100,
    conversions: Math.round(conversions),
  };
}

// ─── GA4 ─────────────────────────────────────────────────────────────────────
export interface GA4Metrics {
  sessions: number;
}

/**
 * @param propertyId  GA4 numeric property ID (e.g. "123456789")
 */
export async function fetchGA4Metrics(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4Metrics> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await axios.post(
    url,
    {
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "sessions" }],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    }
  );

  const sessions =
    parseInt(res.data?.rows?.[0]?.metricValues?.[0]?.value ?? "0", 10);
  return { sessions };
}
