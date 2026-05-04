/**
 * Meta Ads connector (Facebook Marketing API)
 *
 * Ad Spend  = spend field
 * Revenue   = action_values for purchase / lead events
 * Leads     = actions where action_type = lead or offsite_conversion.fb_pixel_lead
 *
 * Auth: Long-lived access token (never expires as long as app is active and
 * the token is refreshed before 60 days).
 * The token is stored as service "meta_token" in api_credentials.
 */

import axios from "axios";

const META_API_VERSION = "v19.0";
const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaAdsMetrics {
  adSpend: number;
  revenue: number;   // purchase conversion value
  leads: number;
  costPerLead: number;
}

/**
 * @param adAccountId  Format: act_XXXXXXXXX  (include the "act_" prefix)
 * @param accessToken  Long-lived Meta access token
 * @param startDate    YYYY-MM-DD
 * @param endDate      YYYY-MM-DD
 */
export async function fetchMetaAdsMetrics(
  adAccountId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<MetaAdsMetrics> {
  const fields = [
    "spend",
    "action_values",
    "actions",
  ].join(",");

  const res = await axios.get(`${BASE}/${adAccountId}/insights`, {
    params: {
      access_token: accessToken,
      fields,
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      level: "account",
    },
    timeout: 20_000,
  });

  const data = res.data?.data?.[0];
  if (!data) return { adSpend: 0, revenue: 0, leads: 0, costPerLead: 0 };

  const adSpend = parseFloat(data.spend ?? "0");

  // Revenue: sum of purchase action_values
  const revenue = (data.action_values ?? [])
    .filter((a: any) =>
      ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"].includes(
        a.action_type
      )
    )
    .reduce((sum: number, a: any) => sum + parseFloat(a.value ?? "0"), 0);

  // Leads: count of lead actions
  const leads = (data.actions ?? [])
    .filter((a: any) =>
      ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"].includes(
        a.action_type
      )
    )
    .reduce((sum: number, a: any) => sum + parseInt(a.value ?? "0", 10), 0);

  const costPerLead = leads > 0 ? Math.round((adSpend / leads) * 100) / 100 : 0;

  return {
    adSpend: Math.round(adSpend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    leads,
    costPerLead,
  };
}

/**
 * Refresh a long-lived Meta token.
 * Meta long-lived tokens last ~60 days. Call this periodically.
 */
export async function refreshMetaToken(
  appId: string,
  appSecret: string,
  currentToken: string
): Promise<string> {
  const res = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentToken,
    },
    timeout: 10_000,
  });
  return res.data.access_token;
}
