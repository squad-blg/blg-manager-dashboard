/**
 * Go High Level (GHL) connector
 *
 * Fetches contacts added within a date range for a specific GHL location.
 * This is the authoritative lead count — matches what DMMs see in
 * GHL › Contacts › Smart List › All (filtered by date added).
 *
 * Auth: Private Integration Token  →  Authorization: Bearer pit-...
 * API version header: Version: 2021-07-28
 *
 * Endpoint: GET https://services.leadconnectorhq.com/contacts/
 * Params:   locationId, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), limit, page
 * Response: { contacts: [...], meta: { total, currentPage, nextPage } }
 */

import axios from "axios";

const BASE_URL    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface GHLMetrics {
  leads: number;
}

/**
 * Returns the number of contacts added to a GHL location
 * within the given date range (= monthly new leads).
 *
 * @param apiKey     GHL Private Integration Token (pit-...)
 * @param locationId GHL location ID (from the dashboard URL)
 * @param startDate  YYYY-MM-DD (inclusive)
 * @param endDate    YYYY-MM-DD (inclusive)
 */
export async function fetchGHLLeads(
  apiKey: string,
  locationId: string,
  startDate: string,
  endDate: string
): Promise<GHLMetrics> {
  let total    = 0;
  let page     = 1;
  const limit  = 100;
  const MAX_PAGES = 50; // safety cap — up to 5 000 contacts

  console.log(`[ghl] Fetching contacts for location ${locationId}  ${startDate} → ${endDate}`);

  for (let i = 0; i < MAX_PAGES; i++) {
    let contacts: any[];
    let nextPage: number | null = null;

    try {
      const res = await axios.get(`${BASE_URL}/contacts/`, {
        params: { locationId, startDate, endDate, page, limit },
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_VERSION,
        },
        timeout: 20_000,
      });

      const body = res.data;
      contacts   = Array.isArray(body?.contacts) ? body.contacts : [];
      nextPage   = body?.meta?.nextPage ?? null;

      console.log(`[ghl] Page ${page}: ${contacts.length} contacts (running total: ${total + contacts.length})`);
    } catch (e: any) {
      console.error(`[ghl] Contacts fetch failed (page ${page}):`, e.message, e.response?.data ?? "");
      break;
    }

    total += contacts.length;

    if (contacts.length < limit || !nextPage) break;
    page++;
  }

  console.log(`[ghl] Total contacts (leads): ${total}`);
  return { leads: total };
}

// ── Backwards-compat alias (used in routes.ts) ────────────────────────────────
/** @deprecated Use fetchGHLLeads instead */
export async function fetchGHLSurveySubmits(
  apiKey: string,
  locationId: string,
  startDate: string,
  endDate: string
): Promise<{ surveySubmits: number }> {
  const r = await fetchGHLLeads(apiKey, locationId, startDate, endDate);
  return { surveySubmits: r.leads };
}
