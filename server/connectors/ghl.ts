/**
 * Go High Level (GHL) connector
 *
 * Fetches survey submissions for a specific GHL location.
 * Used for clients whose lead source is GHL survey submits (not ad conversions).
 *
 * Auth: Private Integration Token  →  Authorization: Bearer pit-...
 * API version header: Version: 2021-07-28
 *
 * Endpoint: GET https://services.leadconnectorhq.com/surveys/submissions
 * Params:   locationId, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), page, limit
 * Response: { submissions: [...], meta: { total, currentPage, nextPage } }
 */

import axios from "axios";

const BASE_URL   = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface GHLMetrics {
  surveySubmits: number;
}

/**
 * Returns the total number of survey submissions for a GHL location
 * within the given date range.
 *
 * @param apiKey     GHL Private Integration Token (pit-...)
 * @param locationId GHL location ID (from the dashboard URL)
 * @param startDate  YYYY-MM-DD (inclusive)
 * @param endDate    YYYY-MM-DD (inclusive)
 */
export async function fetchGHLSurveySubmits(
  apiKey: string,
  locationId: string,
  startDate: string,
  endDate: string
): Promise<GHLMetrics> {
  let total   = 0;
  let page    = 1;
  const limit = 100;
  const MAX_PAGES = 20; // safety cap — up to 2 000 submissions

  console.log(`[ghl] Fetching survey submissions for location ${locationId}  ${startDate} → ${endDate}`);

  for (let i = 0; i < MAX_PAGES; i++) {
    let submissions: any[];
    let nextPage: number | null = null;

    try {
      const res = await axios.get(`${BASE_URL}/surveys/submissions`, {
        params: { locationId, startAt: startDate, endAt: endDate, page, limit },
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_VERSION,
        },
        timeout: 20_000,
      });

      const body    = res.data;
      submissions   = Array.isArray(body?.submissions) ? body.submissions : [];
      nextPage      = body?.meta?.nextPage ?? null;

      console.log(`[ghl] Page ${page}: ${submissions.length} submissions (running total: ${total + submissions.length})`);
    } catch (e: any) {
      console.error(`[ghl] Survey submissions fetch failed (page ${page}):`, e.message, e.response?.data ?? "");
      break;
    }

    total += submissions.length;

    if (submissions.length < limit || !nextPage) break;
    page++;
  }

  console.log(`[ghl] Total survey submits: ${total}`);
  return { surveySubmits: total };
}
