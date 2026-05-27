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
  purchases: number; // purchase conversions (for ecommerce/rental clients)
  costPerLead: number;
}

/**
 * @param adAccountId          Format: act_XXXXXXXXX  (include the "act_" prefix)
 * @param accessToken          Long-lived Meta access token
 * @param startDate            YYYY-MM-DD
 * @param endDate              YYYY-MM-DD
 * @param useDefaultAttribution  When true, omits attribution window overrides so the API
 *                               returns the same lead counts shown in Meta Ads Manager
 *                               (account default: 7-day click + 1-day view).
 *                               Use for LEADGEN clients. Default false keeps 7d_click-only
 *                               to prevent view-through inflation on purchase metrics.
 */
export async function fetchMetaAdsMetrics(
  adAccountId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
  useDefaultAttribution = false,
): Promise<MetaAdsMetrics> {
  // Ensure the account ID has the required act_ prefix
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const fields = [
    "spend",
    "action_values",
    "actions",
  ].join(",");

  const params: Record<string, string> = {
    access_token: accessToken,
    fields,
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    level: "account",
    action_report_time: "conversion",
  };

  // For purchase-based accounts (ERS, IO, ecomm) keep 7d_click only to avoid
  // inflating purchase counts with view-through conversions.
  // For lead gen accounts, omit the override so counts match Meta Ads Manager.
  if (!useDefaultAttribution) {
    params.action_attribution_windows = JSON.stringify(["7d_click"]);
    params.use_unified_attribution_setting = "false";
  }

  const res = await axios.get(`${BASE}/${accountId}/insights`, {
    params,
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

  // Leads: use only the "lead" umbrella action type — it already includes
  // offsite_conversion.fb_pixel_lead and onsite_conversion.lead_grouped as sub-types.
  // Summing sub-types alongside the parent causes double-counting.
  const leadAction = (data.actions ?? []).find((a: any) => a.action_type === "lead");
  const leads = leadAction ? parseInt(leadAction.value ?? "0", 10) : 0;

  // Purchases: count of purchase actions (ecommerce/rental clients like ERS)
  const purchases = (data.actions ?? [])
    .filter((a: any) =>
      ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"].includes(
        a.action_type
      )
    )
    .reduce((sum: number, a: any) => sum + parseInt(a.value ?? "0", 10), 0);

  // For cost per conversion: use purchases if available, otherwise leads
  const conversions = purchases > 0 ? purchases : leads;
  const costPerLead = conversions > 0 ? Math.round((adSpend / conversions) * 100) / 100 : 0;

  console.log(`[meta:${adAccountId}] spend=$${adSpend} leads=${leads} purchases=${purchases} revenue=$${Math.round(revenue * 100) / 100}`);

  return {
    adSpend: Math.round(adSpend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    leads,
    purchases,
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
