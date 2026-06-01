import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { extractTextFromFile, chunkText, chat } from "./ai";
import { getGoogleAccessToken, fetchGoogleAdsMetrics, fetchGA4Metrics } from "./connectors/google";
import { fetchMetaAdsMetrics, refreshMetaToken } from "./connectors/meta";
import { fetchERSMetrics } from "./connectors/ers";
import { fetchSheetsRevenue } from "./connectors/googlesheets";
import { fetchIOMetrics } from "./connectors/io";
import { fetchGHLSurveySubmits } from "./connectors/ghl";

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    cb(null, allowed.includes(file.mimetype) || file.mimetype.startsWith("text/"));
  },
});


export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ─── Managers ───────────────────────────────────────────────────────────
  app.get("/api/managers", (_req, res) => {
    res.json(storage.getManagers());
  });

  // ─── Clients ────────────────────────────────────────────────────────────
  app.get("/api/clients", (req, res) => {
    const { managerId } = req.query;
    res.json(storage.getClients(managerId as string | undefined));
  });

  app.post("/api/clients", (req, res) => {
    try {
      const client = storage.createClient(req.body);
      res.json(client);

      // Auto-backfill current month + last 13 months so YoY/YTD are
      // populated immediately for any new client.
      setImmediate(async () => {
        console.log(`[backfill] Starting 14-month backfill for new client: ${client.name}`);

        // Warn early if ERS client is missing credentials — saves confusion later
        if (client.platform === "ERS") {
          const missing = ["ersFolder", "ersApiKey", "ersDevKey"].filter(k => !client[k as keyof typeof client]);
          if (missing.length > 0) {
            console.warn(`[backfill] ${client.name} is ERS but missing: ${missing.join(", ")} — revenue will not be fetched`);
          }
        }

        const now = new Date();
        const periods: string[] = [];
        let y = now.getFullYear();
        let m = now.getMonth() + 1;
        // Include current month first, then go back 13 months
        periods.push(`${y}-${String(m).padStart(2, "0")}`);
        for (let i = 0; i < 13; i++) {
          m -= 1;
          if (m === 0) { m = 12; y -= 1; }
          periods.push(`${y}-${String(m).padStart(2, "0")}`);
        }

        const googleCreds = storage.getCredentials().find((c) => c.service === "google_oauth");
        const mccId       = storage.getCredentials().find((c) => c.service === "google_mcc_id");
        const metaCreds   = storage.getCredentials().find((c) => c.service === "meta_token");

        let googleAccessToken: string | null = null;
        if (googleCreds) {
          try {
            const [cid, csec, rt] = googleCreds.key.split("|");
            googleAccessToken = await getGoogleAccessToken(cid, csec, rt);
          } catch (e: any) {
            console.error("[backfill] Google token refresh failed:", e.message);
          }
        }

        for (const period of periods) {
          const [py, pm] = period.split("-").map(Number);
          const startDate = `${py}-${String(pm).padStart(2, "0")}-01`;
          const lastDay = new Date(py, pm, 0).getDate();
          const endDate = `${py}-${String(pm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          // ERS always uses full month end date to capture all bookings
          const ersBackfillEndDate = endDate;
          const fetchedAt = new Date().toISOString();

          try {
            // ERS
            if (client.platform === "ERS" && client.ersFolder && client.ersApiKey && client.ersDevKey) {
              try {
                const m2 = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, ersBackfillEndDate);
                storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: m2.revenue, orderCount: m2.orderCount, fetchedAt });
              } catch (e: any) { console.error(`[backfill] ${client.name} ERS ${period}:`, e.message); }
            }

            // IO
            if (client.platform === "IO") {
              if (client.ioApiKey) {
                try {
                  const m2 = await fetchIOMetrics(client.ioApiKey, startDate, endDate, client.ioLocationId);
                  storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: m2.revenue, orderCount: m2.totalEvents, fetchedAt });
                  console.log(`[backfill] ${client.name} IO ${period}: $${m2.revenue} (${m2.totalEvents} events)`);
                } catch (e: any) { console.error(`[backfill] ${client.name} IO ${period}:`, e.message); }
              }
            }

            // Google Ads + GA4
            if (googleAccessToken && client.googleAdsCustomerId) {
              try {
                const ads = await fetchGoogleAdsMetrics(
                  googleAccessToken, client.googleAdsCustomerId,
                  mccId?.key ?? client.googleAdsCustomerId, startDate, endDate
                );
                const hasOwnRevenuePlatform = client.platform === "ERS" || client.platform === "IO";
                if (!hasOwnRevenuePlatform) {
                  storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: ads.revenue, orderCount: ads.conversions, fetchedAt });
                }
                let sessions = 0, organicSessions = 0, organicConversions = 0;
                if (client.ga4PropertyId) {
                  try {
                    const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
                    sessions = ga4.sessions;
                    organicSessions = ga4.organicSessions;
                    organicConversions = ga4.organicConversions;
                  } catch (e: any) { console.error(`[backfill] ${client.name} GA4 ${period}:`, e.message); }
                }
                const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === period);
                const metaSpend = existing?.metaAdSpend ?? 0;
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  googleAdSpend: ads.adSpend, metaAdSpend: metaSpend,
                  adSpend: Math.round((ads.adSpend + metaSpend) * 100) / 100,
                  sessions, organicSessions, organicConversions,
                  conversions: ads.conversions,
                  leads: existing?.leads ?? 0, costPerLead: existing?.costPerLead ?? 0,
                  conversionRate: existing?.conversionRate ?? 0,
                  impressions: existing?.impressions ?? 0, clicks: existing?.clicks ?? 0, fetchedAt,
                });
              } catch (e: any) { console.error(`[backfill] ${client.name} Google Ads ${period}:`, e.message); }
            }

            // Meta Ads
            if (metaCreds && client.metaAdAccountId) {
              try {
                const m2 = await fetchMetaAdsMetrics(client.metaAdAccountId, metaCreds.key, startDate, endDate, !["ERS", "IO", "ECOMM"].includes(client.platform));
                const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === period);
                const googleSpend = existing?.googleAdSpend ?? 0;
                const metaPurchases = m2.purchases ?? 0;
                const metaConversions = metaPurchases > 0 ? metaPurchases : m2.leads;
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  googleAdSpend: googleSpend, metaAdSpend: m2.adSpend,
                  adSpend: Math.round((googleSpend + m2.adSpend) * 100) / 100,
                  leads: metaConversions,
                  costPerLead: metaConversions > 0 ? Math.round((m2.adSpend / metaConversions) * 100) / 100 : 0,
                  sessions: existing?.sessions ?? 0, conversions: existing?.conversions ?? 0,
                  conversionRate: existing?.conversionRate ?? 0,
                  impressions: existing?.impressions ?? 0, clicks: existing?.clicks ?? 0, fetchedAt,
                });
              } catch (e: any) { console.error(`[backfill] ${client.name} Meta ${period}:`, e.message); }
            }

            // SEO — GA4 only (organic sessions as primary metric)
            if (client.platform === "SEO" && googleAccessToken && client.ga4PropertyId) {
              try {
                const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  sessions: ga4.sessions,
                  organicSessions: ga4.organicSessions,
                  organicConversions: ga4.organicConversions,
                  googleAdSpend: 0, metaAdSpend: 0, adSpend: 0,
                  leads: 0, costPerLead: 0, conversions: 0,
                  conversionRate: 0, impressions: 0, clicks: 0,
                  fetchedAt,
                });
                console.log(`[backfill] ${client.name} SEO/GA4 ${period}: sessions=${ga4.sessions} organic=${ga4.organicSessions}`);
              } catch (e: any) { console.error(`[backfill] ${client.name} SEO/GA4 ${period}:`, e.message); }
            }

            // GHL Survey Submissions — overrides Meta lead count for GHL clients
            if (client.ghlLocationId && client.ghlApiKey) {
              try {
                const ghl = await fetchGHLSurveySubmits(client.ghlApiKey, client.ghlLocationId, startDate, endDate);
                const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === period);
                const totalSpend = existing?.adSpend ?? 0;
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  googleAdSpend: existing?.googleAdSpend ?? 0,
                  metaAdSpend: existing?.metaAdSpend ?? 0,
                  adSpend: totalSpend,
                  leads: ghl.surveySubmits,
                  costPerLead: ghl.surveySubmits > 0 && totalSpend > 0
                    ? Math.round((totalSpend / ghl.surveySubmits) * 100) / 100
                    : (existing?.costPerLead ?? 0),
                  sessions: existing?.sessions ?? 0,
                  conversions: existing?.conversions ?? 0,
                  conversionRate: existing?.conversionRate ?? 0,
                  impressions: existing?.impressions ?? 0,
                  clicks: existing?.clicks ?? 0,
                  fetchedAt,
                });
                console.log(`[backfill] ${client.name} GHL ${period}: surveySubmits=${ghl.surveySubmits}`);
              } catch (e: any) { console.error(`[backfill] ${client.name} GHL ${period}:`, e.message); }
            }

            console.log(`[backfill] ${client.name} ${period} done`);
          } catch (e: any) {
            console.error(`[backfill] ${client.name} ${period} unexpected:`, e.message);
          }
        }
        console.log(`[backfill] ${client.name} complete — ${periods.length} months backfilled`);
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Full re-backfill ─────────────────────────────────────────────────────
  // POST /api/rebackfill — wipes all revenue/analytics snapshots and re-syncs
  // from January 2024 through current month. Use when revenue field changes.
  app.post("/api/rebackfill", async (req, res) => {
    const clients = storage.getClients();
    const { clientId } = req.body; // optional — if provided, only re-backfill that client

    res.json({ ok: true, message: "Full re-backfill started — check Railway logs for progress" });

    setImmediate(async () => {
      console.log("[rebackfill] Starting full re-backfill...");

      // Build list of all periods from Jan 2024 to current month
      const now = new Date();
      const periods: string[] = [];
      let y = 2024, m = 1;
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        periods.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
      console.log(`[rebackfill] ${periods.length} months to sync: ${periods[0]} → ${periods[periods.length - 1]}`);

      // Get credentials
      const creds = storage.getCredentials();
      const googleCreds = creds.find(c => c.service === "google_oauth");
      const metaCreds = creds.find(c => c.service === "meta_token");
      const mccId = creds.find(c => c.service === "google_mcc_id");

      let googleAccessToken: string | null = null;
      if (googleCreds) {
        try {
          const [cid, csec, rt] = googleCreds.key.split("|");
          googleAccessToken = await getGoogleAccessToken(cid, csec, rt);
        } catch (e: any) {
          console.error("[rebackfill] Google token refresh failed:", e.message);
        }
      }

      const targetClients = clientId
        ? clients.filter(c => c.id === clientId)
        : clients;

      for (const client of targetClients) {
        console.log(`[rebackfill] Processing ${client.name}...`);

        for (const period of periods) {
          const [py, pm] = period.split("-").map(Number);
          const startDate = `${py}-${String(pm).padStart(2, "0")}-01`;
          const lastDay = new Date(py, pm, 0).getDate();
          const endDate = `${py}-${String(pm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          const fetchedAt = new Date().toISOString();

          try {
            // IO — Inflatable Office
            if (client.platform === "IO") {
              if (client.ioApiKey) {
                try {
                  const m2 = await fetchIOMetrics(client.ioApiKey, startDate, endDate, client.ioLocationId);
                  storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: m2.revenue, orderCount: m2.totalEvents, fetchedAt });
                  console.log(`[rebackfill] ${client.name} IO ${period}: $${m2.revenue} (${m2.totalEvents} events)`);
                } catch (e: any) { console.error(`[rebackfill] ${client.name} IO ${period}:`, e.message); }
              }
            }

            // ERS — always use full month end date
            if (client.platform === "ERS" && client.ersFolder && client.ersApiKey && client.ersDevKey) {
              try {
                const m2 = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, endDate);
                storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: m2.revenue, orderCount: m2.orderCount, fetchedAt });
                console.log(`[rebackfill] ${client.name} ERS ${period}: $${m2.revenue} (${m2.orderCount} orders)`);
              } catch (e: any) { console.error(`[rebackfill] ${client.name} ERS ${period}:`, e.message); }
            }

            // Google Ads + GA4
            if (googleAccessToken && client.googleAdsCustomerId) {
              try {
                const ads = await fetchGoogleAdsMetrics(
                  googleAccessToken, client.googleAdsCustomerId,
                  mccId?.key ?? client.googleAdsCustomerId, startDate, endDate
                );
                const hasOwnRevenuePlatform = ["ERS", "IO", "SHEETS"].includes(client.platform); // IO = InflatableOffice
                if (!hasOwnRevenuePlatform) {
                  storage.upsertRevenueSnapshot({ clientId: client.id, period, periodType: "month", revenue: ads.revenue, orderCount: ads.conversions, fetchedAt });
                }
                let sessions = 0, organicSessions = 0, organicConversions = 0;
                if (client.ga4PropertyId) {
                  try {
                    const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
                    sessions = ga4.sessions;
                    organicSessions = ga4.organicSessions;
                    organicConversions = ga4.organicConversions;
                  } catch (e: any) { console.error(`[rebackfill] ${client.name} GA4 ${period}:`, e.message); }
                }
                const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === period);
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  googleAdSpend: ads.adSpend, metaAdSpend: existing?.metaAdSpend ?? 0,
                  adSpend: Math.round((ads.adSpend + (existing?.metaAdSpend ?? 0)) * 100) / 100,
                  sessions, organicSessions, organicConversions,
                  conversions: ads.conversions,
                  leads: existing?.leads ?? 0, costPerLead: existing?.costPerLead ?? 0,
                  conversionRate: existing?.conversionRate ?? 0,
                  impressions: existing?.impressions ?? 0, clicks: existing?.clicks ?? 0, fetchedAt,
                });
                console.log(`[rebackfill] ${client.name} Google ${period}: $${ads.adSpend} spend`);
              } catch (e: any) { console.error(`[rebackfill] ${client.name} Google ${period}:`, e.message); }
            }

            // Meta Ads
            if (metaCreds && client.metaAdAccountId) {
              try {
                const m2 = await fetchMetaAdsMetrics(client.metaAdAccountId, metaCreds.key, startDate, endDate, !["ERS", "IO", "ECOMM"].includes(client.platform));
                const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === period);
                const googleSpend = existing?.googleAdSpend ?? 0;
                const metaPurchases = m2.purchases ?? 0;
                const metaConversions = metaPurchases > 0 ? metaPurchases : m2.leads;
                storage.upsertAnalyticsSnapshot({
                  clientId: client.id, period, periodType: "month",
                  googleAdSpend: googleSpend, metaAdSpend: m2.adSpend,
                  adSpend: Math.round((googleSpend + m2.adSpend) * 100) / 100,
                  leads: metaConversions,
                  costPerLead: metaConversions > 0 ? Math.round((m2.adSpend / metaConversions) * 100) / 100 : 0,
                  sessions: existing?.sessions ?? 0, conversions: existing?.conversions ?? 0,
                  conversionRate: existing?.conversionRate ?? 0,
                  impressions: existing?.impressions ?? 0, clicks: existing?.clicks ?? 0, fetchedAt,
                });
                console.log(`[rebackfill] ${client.name} Meta ${period}: $${m2.adSpend} spend, ${metaConversions} conversions`);
              } catch (e: any) { console.error(`[rebackfill] ${client.name} Meta ${period}:`, e.message); }
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));

          } catch (e: any) {
            console.error(`[rebackfill] ${client.name} ${period} unexpected:`, e.message);
          }
        }
        console.log(`[rebackfill] ${client.name} complete`);
      }
      console.log("[rebackfill] Full re-backfill complete!");
    });
  });

  app.patch("/api/clients/:id", (req, res) => {
    const updated = storage.updateClient(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/clients/:id", (req, res) => {
    storage.deleteClient(req.params.id);
    res.json({ ok: true });
  });

  // ─── Revenue ────────────────────────────────────────────────────────────
  app.get("/api/revenue/:clientId", (req, res) => {
    const { periodType = "month" } = req.query;
    const snapshots = storage.getRevenueSnapshots(req.params.clientId, periodType as string);
    res.json(snapshots);
  });

  // ERS live fetch proxy
  app.post("/api/fetch/ers/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client || client.platform !== "ERS") {
      return res.status(400).json({ error: "Not an ERS client" });
    }
    if (!client.ersFolder || !client.ersApiKey || !client.ersDevKey) {
      return res.status(400).json({ error: "ERS folder, API token, and developer key required" });
    }
    try {
      const { startDate, endDate } = req.body;
      const m = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, ersEndDate);
      res.json(m);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // IO live fetch proxy
  app.post("/api/fetch/io/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client || client.platform !== "IO") {
      return res.status(400).json({ error: "Not an IO client" });
    }
    if (!client.ioApiKey) {
      return res.status(400).json({ error: "IO API key not configured" });
    }
    try {
      const { startDate, endDate } = req.body;
      const metrics = await fetchIOMetrics(client.ioApiKey, startDate, endDate, client.ioLocationId);
      res.json(metrics);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // IO Locations proxy — returns the list of locations for a given IO API key.
  // Used by the Clients form to populate the location picker without exposing
  // the API key to the browser.
  app.get("/api/io/locations", async (req, res) => {
    const { apiKey } = req.query as { apiKey?: string };
    if (!apiKey) return res.status(400).json({ error: "apiKey required" });
    try {
      const result = await axios.get("https://rental.software/api6/locations/", {
        params: { apiKey, offset: 0, limit: 100 },
        timeout: 10_000,
      });
      // Return just the items array to the client
      const items: Array<{ id: string; name: string }> = (result.data?.items ?? []).map(
        (loc: any) => ({ id: String(loc.id), name: loc.name })
      );
      res.json({ locations: items });
    } catch (e: any) {
      const status = e.response?.status ?? 500;
      // Pass through the full IO error body so the client can show it verbatim
      const ioBody = e.response?.data;
      const message = (typeof ioBody === "object" ? ioBody?.message : ioBody)
        ?? e.message
        ?? "Unknown error from IO API";
      console.error(`[io-locations] ${status}: ${message}`);
      res.status(status).json({ error: message, raw: ioBody });
    }
  });

  // Google Ads live fetch proxy
  app.post("/api/fetch/google/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client?.googleAdsCustomerId) {
      return res.status(400).json({ error: "Google Ads Customer ID not configured for this client" });
    }
    const googleCreds = storage.getCredentials().find((c) => c.service === "google_oauth");
    const mccId = storage.getCredentials().find((c) => c.service === "google_mcc_id");
    if (!googleCreds) {
      return res.status(400).json({ error: "Google OAuth credentials not configured in Settings" });
    }
    try {
      const [clientId, clientSecret, refreshToken] = googleCreds.key.split("|");
      const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);
      const { startDate, endDate } = req.body;
      const adsMetrics = await fetchGoogleAdsMetrics(
        accessToken,
        client.googleAdsCustomerId,
        mccId?.key ?? client.googleAdsCustomerId,
        startDate,
        endDate
      );
      let sessions = 0, organicSessions = 0, organicConversions = 0;
      if (client.ga4PropertyId) {
        const ga4 = await fetchGA4Metrics(accessToken, client.ga4PropertyId, startDate, endDate);
        sessions = ga4.sessions;
        organicSessions = ga4.organicSessions;
        organicConversions = ga4.organicConversions;
      }
      res.json({ ...adsMetrics, sessions, organicSessions, organicConversions });
    } catch (e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });

  // Meta raw actions debug — returns every action type + value for a date range
  // GET /api/debug/meta/:clientId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  app.get("/api/debug/meta/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client?.metaAdAccountId) return res.status(400).json({ error: "No Meta account ID" });
    const metaCreds = storage.getCredentials().find((c) => c.service === "meta_token");
    if (!metaCreds) return res.status(400).json({ error: "Meta token not configured" });
    const { startDate = "2026-05-01", endDate = "2026-05-27" } = req.query as Record<string, string>;
    try {
      const axios = (await import("axios")).default;
      const accountId = client.metaAdAccountId.startsWith("act_")
        ? client.metaAdAccountId : `act_${client.metaAdAccountId}`;
      const r = await axios.get(`https://graph.facebook.com/v19.0/${accountId}/insights`, {
        params: {
          access_token: metaCreds.key,
          fields: "spend,actions,action_values",
          time_range: JSON.stringify({ since: startDate, until: endDate }),
          level: "account",
          action_report_time: "conversion",
        },
        timeout: 20_000,
      });
      const data = r.data?.data?.[0] ?? {};
      res.json({
        adAccountId: client.metaAdAccountId,
        clientName: client.name,
        platform: client.platform,
        period: `${startDate} → ${endDate}`,
        spend: data.spend,
        actions: (data.actions ?? []).sort((a: any, b: any) => parseFloat(b.value) - parseFloat(a.value)),
        action_values: data.action_values ?? [],
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });

  // Meta Ads live fetch proxy
  app.post("/api/fetch/meta/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client?.metaAdAccountId) {
      return res.status(400).json({ error: "Meta Ad Account ID not configured for this client" });
    }
    const metaCreds = storage.getCredentials().find((c) => c.service === "meta_token");
    if (!metaCreds) {
      return res.status(400).json({ error: "Meta access token not configured in Settings" });
    }
    try {
      const { startDate, endDate } = req.body;
      const metrics = await fetchMetaAdsMetrics(
        client.metaAdAccountId,
        metaCreds.key,
        startDate,
        endDate,
        !["ERS", "IO", "ECOMM"].includes(client.platform),
      );
      res.json(metrics);
    } catch (e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });

  // Meta token refresh endpoint
  app.post("/api/refresh/meta", async (req, res) => {
    const metaCreds = storage.getCredentials().find((c) => c.service === "meta_token");
    const metaApp   = storage.getCredentials().find((c) => c.service === "meta_app");
    if (!metaCreds || !metaApp) {
      return res.status(400).json({ error: "Meta credentials not configured" });
    }
    try {
      const [appId, appSecret] = metaApp.key.split("|");
      const newToken = await refreshMetaToken(appId, appSecret, metaCreds.key);
      storage.upsertCredential({ id: "meta_token", service: "meta_token", key: newToken, label: "Meta Access Token", updatedAt: new Date().toISOString() });
      res.json({ ok: true, message: "Meta token refreshed" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Sync all clients for a given period ────────────────────────────────
  // POST /api/sync  { period: "2026-05" }
  // Fetches revenue + analytics for every client that has credentials configured
  // and upserts snapshots into the DB. Runs in the background.
  app.post("/api/sync", async (req, res) => {
    const { period } = req.body as { period?: string };
    const now = new Date();
    const targetPeriod = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [year, month] = targetPeriod.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const isCurrentMonth = year === now.getFullYear() && month === (now.getMonth() + 1);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    // Meta/Google use today as end date to avoid attribution window inflation
    // ERS uses full month end to capture all bookings scheduled for the month
    const endDate = isCurrentMonth ? todayStr : monthEndStr;
    const ersEndDate = monthEndStr; // ERS always uses full month to capture future bookings

    // Respond immediately — sync runs in background
    res.json({ ok: true, period: targetPeriod, startDate, endDate, message: "Sync started" });

    setImmediate(async () => {
      const clients = storage.getClients();
      const googleCreds = storage.getCredentials().find((c) => c.service === "google_oauth");
      const mccId       = storage.getCredentials().find((c) => c.service === "google_mcc_id");
      const metaCreds   = storage.getCredentials().find((c) => c.service === "meta_token");

      let googleAccessToken: string | null = null;
      if (googleCreds) {
        try {
          const [cid, csec, rt] = googleCreds.key.split("|");
          googleAccessToken = await getGoogleAccessToken(cid, csec, rt);
        } catch (e: any) {
          console.error("[sync] Google token refresh failed:", e.message);
        }
      }

      for (const client of clients) {
        try {
          const fetchedAt = new Date().toISOString();

          // ── ERS ────────────────────────────────────────────────────────
          if (client.platform === "ERS") {
            if (!client.ersFolder || !client.ersApiKey || !client.ersDevKey) {
              console.warn(`[sync] ${client.name} is ERS but missing credentials (ersFolder=${!!client.ersFolder} ersApiKey=${!!client.ersApiKey} ersDevKey=${!!client.ersDevKey}) — skipping revenue fetch`);
            } else {
              try {
                const m = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, ersEndDate);
                storage.upsertRevenueSnapshot({ clientId: client.id, period: targetPeriod, periodType: "month", revenue: m.revenue, orderCount: m.orderCount, fetchedAt });
                console.log(`[sync] ${client.name} ERS: orders=${m.orderCount} revenue=$${m.revenue}`);
              } catch (e: any) {
                console.error(`[sync] ${client.name} ERS:`, e.message);
              }
            }
          }

          // ── IO ─────────────────────────────────────────────────────────
          if (client.platform === "IO") {
            if (!client.ioApiKey) {
              console.warn(`[sync] ${client.name} is IO but missing ioApiKey — skipping`);
            } else {
              try {
                const m = await fetchIOMetrics(client.ioApiKey, startDate, ersEndDate, client.ioLocationId);
                storage.upsertRevenueSnapshot({ clientId: client.id, period: targetPeriod, periodType: "month", revenue: m.revenue, orderCount: m.totalEvents, fetchedAt });
                console.log(`[sync] ${client.name} IO: events=${m.totalEvents} revenue=$${m.revenue}`);
              } catch (e: any) { console.error(`[sync] ${client.name} IO:`, e.message); }
            }
          }

          // ── Google Ads + GA4 ───────────────────────────────────────────
          if (googleAccessToken && client.googleAdsCustomerId) {
            try {
              const ads = await fetchGoogleAdsMetrics(
                googleAccessToken,
                client.googleAdsCustomerId,
                mccId?.key ?? client.googleAdsCustomerId,
                startDate, endDate
              );
              // Only write revenue from Google Ads if this client's primary
              // revenue platform is NOT ERS or IO (those have their own revenue source)
              const hasOwnRevenuePlatform = client.platform === "ERS" || client.platform === "IO";
              if (!hasOwnRevenuePlatform) {
                storage.upsertRevenueSnapshot({ clientId: client.id, period: targetPeriod, periodType: "month", revenue: ads.revenue, orderCount: ads.conversions, fetchedAt });
              }

              let sessions = 0, organicSessions = 0, organicConversions = 0;
              if (client.ga4PropertyId) {
                try {
                  const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
                  sessions = ga4.sessions;
                  organicSessions = ga4.organicSessions;
                  organicConversions = ga4.organicConversions;
                } catch (e: any) {
                  console.error(`[sync] ${client.name} GA4:`, e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0,300) : '');
                }
              }
              // Upsert analytics: store googleAdSpend separately, combine with existing metaAdSpend for total
              const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === targetPeriod);
              const metaSpend = existing?.metaAdSpend ?? 0;
              const totalSpend = Math.round((ads.adSpend + metaSpend) * 100) / 100;
              storage.upsertAnalyticsSnapshot({
                clientId: client.id, period: targetPeriod, periodType: "month",
                googleAdSpend: ads.adSpend,
                metaAdSpend: metaSpend,
                adSpend: totalSpend,
                sessions,
                organicSessions,
                organicConversions,
                conversions: ads.conversions,
                leads: existing?.leads ?? 0,
                costPerLead: existing?.costPerLead ?? 0,
                conversionRate: existing?.conversionRate ?? 0,
                impressions: existing?.impressions ?? 0,
                clicks: existing?.clicks ?? 0,
                fetchedAt,
              });
              console.log(`[sync] ${client.name} Google Ads: spend=$${ads.adSpend} conversions=${ads.conversions}${!hasOwnRevenuePlatform ? ` revenue=$${ads.revenue}` : ' (revenue from primary platform)'}`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} Google Ads:`, e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0,500) : '');
            }
          }

          // ── Meta Ads ───────────────────────────────────────────────────
          if (metaCreds && client.metaAdAccountId) {
            try {
              const m = await fetchMetaAdsMetrics(client.metaAdAccountId, metaCreds.key, startDate, endDate, !["ERS", "IO", "ECOMM"].includes(client.platform));
              const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === targetPeriod);
              // Store Meta spend separately; combine with googleAdSpend for total — no compounding
              const googleSpend = existing?.googleAdSpend ?? 0;
              const totalSpend = Math.round((googleSpend + m.adSpend) * 100) / 100;
              const leads = m.leads;
              const metaPurchases = m.purchases ?? 0;
              // Use purchases as the lead metric for rental/ecommerce clients,
              // leads for lead-gen clients. Store the Meta figure directly — do NOT
              // add to Google conversions as that causes accumulation on each sync.
              const metaConversions = metaPurchases > 0 ? metaPurchases : leads;
              const googleConversions = existing?.conversions ?? 0;
              storage.upsertAnalyticsSnapshot({
                clientId: client.id, period: targetPeriod, periodType: "month",
                googleAdSpend: googleSpend,
                metaAdSpend: m.adSpend,
                adSpend: totalSpend,
                // leads field stores the Meta conversion metric (purchases or leads)
                leads: metaConversions,
                costPerLead: metaConversions > 0 ? Math.round((m.adSpend / metaConversions) * 100) / 100 : (existing?.costPerLead ?? 0),
                sessions: existing?.sessions ?? 0,
                // Keep Google conversions separate — do not combine with Meta
                conversions: googleConversions,
                conversionRate: existing?.conversionRate ?? 0,
                impressions: existing?.impressions ?? 0,
                clicks: existing?.clicks ?? 0,
                fetchedAt,
              });
              console.log(`[sync] ${client.name} Meta: spend=$${m.adSpend} leads=${leads} purchases=${metaPurchases} metaConversions=${metaConversions} (google=$${googleSpend} meta=$${m.adSpend} total=$${totalSpend})`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} Meta:`, e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0,500) : '');
            }
          }

          // ── SEO — GA4 only (no ad spend, organic sessions are the primary metric) ──
          if (client.platform === "SEO" && googleAccessToken && client.ga4PropertyId) {
            try {
              const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
              storage.upsertAnalyticsSnapshot({
                clientId: client.id, period: targetPeriod, periodType: "month",
                sessions: ga4.sessions,
                organicSessions: ga4.organicSessions,
                organicConversions: ga4.organicConversions,
                googleAdSpend: 0, metaAdSpend: 0, adSpend: 0,
                leads: 0, costPerLead: 0, conversions: 0,
                conversionRate: 0, impressions: 0, clicks: 0,
                fetchedAt,
              });
              console.log(`[sync] ${client.name} SEO/GA4: sessions=${ga4.sessions} organic=${ga4.organicSessions} conv=${ga4.organicConversions}`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} SEO/GA4:`, e.message, e.response?.data ?? "");
            }
          }

          // ── GHL Survey Submissions (overrides Meta lead count for GHL clients) ──
          if (client.ghlLocationId && client.ghlApiKey) {
            try {
              const ghl = await fetchGHLSurveySubmits(client.ghlApiKey, client.ghlLocationId, startDate, endDate);
              const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === targetPeriod);
              const totalSpend = existing?.adSpend ?? 0;
              storage.upsertAnalyticsSnapshot({
                clientId: client.id, period: targetPeriod, periodType: "month",
                googleAdSpend: existing?.googleAdSpend ?? 0,
                metaAdSpend: existing?.metaAdSpend ?? 0,
                adSpend: totalSpend,
                // GHL survey submits are the authoritative lead count — override Meta conversions
                leads: ghl.surveySubmits,
                costPerLead: ghl.surveySubmits > 0 && totalSpend > 0
                  ? Math.round((totalSpend / ghl.surveySubmits) * 100) / 100
                  : (existing?.costPerLead ?? 0),
                sessions: existing?.sessions ?? 0,
                conversions: existing?.conversions ?? 0,
                conversionRate: existing?.conversionRate ?? 0,
                impressions: existing?.impressions ?? 0,
                clicks: existing?.clicks ?? 0,
                fetchedAt,
              });
              console.log(`[sync] ${client.name} GHL: surveySubmits=${ghl.surveySubmits} (overrides Meta lead count)`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} GHL:`, e.message, e.response?.data ?? "");
            }
          }
        } catch (e: any) {
          console.error(`[sync] ${client.name} unexpected:`, e.message);
        }
      }
      console.log(`[sync] Period ${targetPeriod} complete.`);
    });
  });

  // ─── Sync status ─────────────────────────────────────────────────────────
  // GET /api/sync/status — returns when the last sync ran per client
  app.get("/api/sync/status", (_req, res) => {
    const clients = storage.getClients();
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const status = clients.map((client) => {
      const revSnaps = storage.getRevenueSnapshots(client.id, "month");
      const latest = revSnaps.find(s => s.period === currentPeriod);
      const anySnap = revSnaps[0]; // most recent overall

      const missingErsKeys = client.platform === "ERS"
        ? ["ersFolder", "ersApiKey", "ersDevKey"].filter(k => !client[k as keyof typeof client])
        : [];

      return {
        clientId: client.id,
        name: client.name,
        platform: client.platform,
        currentPeriodRevenue: latest?.revenue ?? null,
        currentPeriodOrders: latest?.orderCount ?? null,
        lastSyncedAt: latest?.fetchedAt ?? anySnap?.fetchedAt ?? null,
        hasCurrentMonth: !!latest,
        missingCredentials: missingErsKeys,
      };
    });

    res.json({ currentPeriod, clients: status });
  });


  app.get("/api/analytics/:clientId", (req, res) => {
    const { periodType = "month" } = req.query;
    const snapshots = storage.getAnalyticsSnapshots(req.params.clientId, periodType as string);
    res.json(snapshots);
  });

  // Agency Analytics proxy
  app.post("/api/fetch/analytics/:clientId", async (req, res) => {
    const client = storage.getClient(req.params.clientId);
    if (!client?.aaaCampaignId) {
      return res.status(400).json({ error: "No Agency Analytics campaign ID configured" });
    }
    const creds = storage.getCredentials().find((c) => c.service === "agency_analytics");
    if (!creds) {
      return res.status(400).json({ error: "Agency Analytics API key not configured" });
    }
    try {
      // Agency Analytics v2 API — campaign read
      const response = await axios.get(
        `https://api.agencyanalytics.com/v2/campaigns/${client.aaaCampaignId}`,
        {
          headers: { Authorization: `Bearer ${creds.key}` },
          timeout: 15000,
        }
      );
      res.json(response.data);
    } catch (e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });

  // ─── Dashboard aggregate (per manager or all) ───────────────────────────
  app.get("/api/dashboard", (req, res) => {
    const { managerId, period: periodParam } = req.query;
    const clients = storage.getClients(managerId as string | undefined);
    const now = new Date();

    // Period helpers — support ?period=YYYY-MM to view any month
    const currentPeriod = (periodParam as string) ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [cpYear, cpMonth] = currentPeriod.split("-").map(Number);

    // MoM: prior month relative to selected period
    const momPeriod = (() => {
      const d = new Date(cpYear, cpMonth - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    // YoY: same month last year
    const yoyPeriod = `${cpYear - 1}-${String(cpMonth).padStart(2, "0")}`;
    // YTD: Jan–selected month this year
    const ytdPrefixCurrent = String(cpYear);
    // YTD prior: Jan–selected month last year
    const ytdPrefixPrior = String(cpYear - 1);

    const pct = (a?: number | null, b?: number | null): number | null => {
      if (a == null || b == null || b === 0) return null;
      return Math.round(((a - b) / b) * 10000) / 100;
    };

    const summary = clients.map((client) => {
      const monthlyRevenue = storage.getRevenueSnapshots(client.id, "month");
      const analytics = storage.getAnalyticsSnapshots(client.id, "month");

      // ── Ad spend ──────────────────────────────────────────────────────────
      const aNow   = analytics.find(a => a.period === currentPeriod);
      const aMoM   = analytics.find(a => a.period === momPeriod);      // prior month
      const aYoY   = analytics.find(a => a.period === yoyPeriod);      // same month last year

      // Use per-platform breakdown when stored; fall back to the combined adSpend field
      const sumSpend = (snap: typeof aNow) => {
        if (!snap) return 0;
        const g = snap.googleAdSpend ?? 0;
        const m = snap.metaAdSpend   ?? 0;
        return (g + m) > 0 ? Math.round((g + m) * 100) / 100 : (snap.adSpend ?? 0);
      };
      const mtdSpend  = sumSpend(aNow);
      const momSpend  = sumSpend(aMoM);
      const yoySpend  = sumSpend(aYoY);
      // Expose the individual platform fields for the frontend breakdown
      const mtdGoogleSpend = aNow?.googleAdSpend ?? 0;
      const mtdMetaSpend   = aNow?.metaAdSpend   ?? 0;
      const momChange = pct(mtdSpend, momSpend);   // MoM: this month vs last month
      const yoyChange = pct(mtdSpend, yoySpend);   // YoY: this month vs same month last year

      // YTD spend: sum Jan–currentMonth this year vs same months last year
      // Use per-platform breakdown (google + meta) where available
      const ytdSpendCurrent = analytics
        .filter(a => a.period.startsWith(ytdPrefixCurrent) && a.period <= currentPeriod)
        .reduce((s, a) => s + sumSpend(a), 0);
      const ytdSpendPrior = analytics
        .filter(a => a.period.startsWith(ytdPrefixPrior) && a.period <= yoyPeriod)
        .reduce((s, a) => s + sumSpend(a), 0);
      // Note: ytdRevenue also scoped to selected period below
      const ytdChange = pct(ytdSpendCurrent, ytdSpendPrior);

      // ── Revenue + YoY/YTD trends ──────────────────────────────────────────
      const mtdRevSnap  = monthlyRevenue.find(r => r.period === currentPeriod);
      const yoyRevSnap  = monthlyRevenue.find(r => r.period === yoyPeriod); // same month last year
      const mtdRevenue  = mtdRevSnap?.revenue ?? 0;
      const yoyRevenue  = yoyRevSnap?.revenue ?? 0;
      // YoY: this month vs same month last year
      const mtdRevenueChange = pct(mtdRevenue, yoyRevenue);

      const ytdRevenue = monthlyRevenue
        .filter(r => r.period.startsWith(ytdPrefixCurrent) && r.period <= currentPeriod)
        .reduce((s, r) => s + r.revenue, 0);
      const ytdPriorRevenue = monthlyRevenue
        .filter(r => r.period.startsWith(ytdPrefixPrior) && r.period <= yoyPeriod)
        .reduce((s, r) => s + r.revenue, 0);
      // YTD: Jan–this month vs Jan–same month last year
      const ytdRevenueChange = pct(ytdRevenue, ytdPriorRevenue);

      // ── ROAS ──────────────────────────────────────────────────────────────
      const mtdRoas = mtdSpend > 0 && mtdRevenue > 0
        ? Math.round((mtdRevenue / mtdSpend) * 100) / 100 : null;
      const ytdRoas = ytdSpendCurrent > 0 && ytdRevenue > 0
        ? Math.round((ytdRevenue / ytdSpendCurrent) * 100) / 100 : null;

      // ── Other ad metrics ──────────────────────────────────────────────────
      const mtdLeads    = aNow?.leads    ?? 0;
      const mtdSessions = aNow?.sessions ?? 0;
      const momLeads    = aMoM?.leads    ?? 0;
      const yoyLeads    = aYoY?.leads    ?? 0;

      // ── Organic (SEO) metrics ─────────────────────────────────────────────
      const mtdOrganicSessions    = aNow?.organicSessions    ?? 0;
      const momOrganicSessions    = aMoM?.organicSessions    ?? 0;
      const yoyOrganicSessions    = aYoY?.organicSessions    ?? 0;
      const mtdOrganicConversions = aNow?.organicConversions ?? 0;

      // ── Churn risk: based on YoY ad spend trend + last touch ──────────────
      const lastTouchDaysAgo = client.lastTouchDate
        ? Math.floor((now.getTime() - new Date(client.lastTouchDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      let churnRisk: "low" | "medium" | "high" = "low";
      if ((yoyChange !== null && yoyChange < -10) && (lastTouchDaysAgo === null || lastTouchDaysAgo > 60)) {
        churnRisk = "high";
      } else if ((yoyChange !== null && yoyChange < -5) || (lastTouchDaysAgo !== null && lastTouchDaysAgo > 45)) {
        churnRisk = "medium";
      }

      // ── History for chart (last 13 months + same months prior year) ───────
      const history = analytics
        .slice(0, 13)
        .reverse()
        .map(a => {
          const priorPeriod = `${parseInt(a.period.split('-')[0]) - 1}-${a.period.split('-')[1]}`;
          const priorA = analytics.find(x => x.period === priorPeriod);
          return {
            period: a.period,
            adSpend: sumSpend(a),
            googleAdSpend: a.googleAdSpend ?? null,
            metaAdSpend: a.metaAdSpend ?? null,
            adSpendPriorYear: priorA ? sumSpend(priorA) : null,
            leads: a.leads ?? null,
            sessions: a.sessions ?? null,
            clicks: a.clicks ?? null,
          };
        });

      // ── Missing credentials detection ─────────────────────────────────────
      const creds = storage.getCredentials();
      const hasGlobalGoogle = !!creds.find(c => c.service === "google_oauth");
      const hasGlobalMeta   = !!creds.find(c => c.service === "meta_token");

      const missing: Record<string, string> = {};

      // ERS credentials
      if (client.platform === "ERS") {
        if (!client.ersFolder)  missing.ersFolder  = "ERS Folder Name";
        if (!client.ersApiKey)  missing.ersApiKey   = "ERS API Token";
        if (!client.ersDevKey)  missing.ersDevKey   = "ERS Developer API Key";
      }
      // IO credentials
      if (client.platform === "IO") {
        if (!client.ioApiKey)   missing.ioApiKey    = "IO API Key";
      }
      // SEO clients only need GA4 — skip all ad-platform credential checks
      if (client.platform === "SEO") {
        if (!client.ga4PropertyId) missing.ga4PropertyId = "GA4 Property ID";
      } else {
        // Google Ads
        if (!client.googleAdsCustomerId) {
          missing.googleAdsCustomerId = "Google Ads Customer ID";
        } else if (!hasGlobalGoogle) {
          missing.googleOAuth = "Google OAuth (configure in Settings)";
        }
        // GA4
        if (!client.ga4PropertyId) {
          missing.ga4PropertyId = "GA4 Property ID";
        }
        // Meta
        if (!client.metaAdAccountId) {
          missing.metaAdAccountId = "Meta Ad Account ID";
        } else if (!hasGlobalMeta) {
          missing.metaToken = "Meta Access Token (configure in Settings)";
        }
        // Agency Analytics
        if (!client.aaaCampaignId) {
          missing.aaaCampaignId = "Agency Analytics Campaign ID";
        }
      }

      return {
        client,
        ads: {
          mtdSpend,
          googleAdSpend: mtdGoogleSpend,
          metaAdSpend: mtdMetaSpend,
          momSpend,
          momChange,
          yoySpend,
          yoyChange,
          ytdSpend: ytdSpendCurrent,
          ytdSpendPrior,
          ytdChange,
          mtdLeads,
          momLeads,
          leadsChange: pct(mtdLeads, momLeads),
          yoyLeads,
          leadsYoyChange: pct(mtdLeads, yoyLeads),
          mtdSessions,
          mtdOrganicSessions,
          momOrganicSessions,
          yoyOrganicSessions,
          organicSessionsChange: pct(mtdOrganicSessions, momOrganicSessions),
          organicSessionsYoYChange: pct(mtdOrganicSessions, yoyOrganicSessions),
          mtdOrganicConversions,
          mtdRoas,
          ytdRoas,
          history,
        },
        revenue: {
          mtd: mtdRevenue,
          mtdPrior: yoyRevenue,
          mtdChange: mtdRevenueChange,
          ytd: ytdRevenue,
          ytdPrior: ytdPriorRevenue,
          ytdChange: ytdRevenueChange,
          history: monthlyRevenue
            .filter(r => r.period.startsWith(String(cpYear)) || r.period.startsWith(String(cpYear - 1)))
            .sort((a, b) => a.period.localeCompare(b.period))
            .map(r => ({ period: r.period, revenue: r.revenue, orderCount: r.orderCount ?? 0 })),
        },
        health: {
          churnRisk,
          lastTouchDate: client.lastTouchDate ?? null,
          lastTouchNote: client.lastTouchNote ?? null,
          lastTouchDaysAgo,
        },
        missingCredentials: missing,
      };
    });

    // ── Portfolio totals ───────────────────────────────────────────────────
    const totalMtdSpend     = summary.reduce((s, c) => s + c.ads.mtdSpend, 0);
    const totalMomSpend     = summary.reduce((s, c) => s + c.ads.momSpend, 0);
    const totalYoySpend     = summary.reduce((s, c) => s + c.ads.yoySpend, 0);
    const totalYtdSpend     = summary.reduce((s, c) => s + c.ads.ytdSpend, 0);
    const totalYtdSpendPrior = summary.reduce((s, c) => s + c.ads.ytdSpendPrior, 0);
    const totalLeads           = summary.reduce((s, c) => s + c.ads.mtdLeads, 0);
    const totalSessions        = summary.reduce((s, c) => s + c.ads.mtdSessions, 0);
    const totalOrganicSessions     = summary.reduce((s, c) => s + c.ads.mtdOrganicSessions, 0);
    const totalMomOrganicSessions  = summary.reduce((s, c) => s + c.ads.momOrganicSessions, 0);
    const totalYoyOrganicSessions  = summary.reduce((s, c) => s + c.ads.yoyOrganicSessions, 0);
    const totalOrganicConversions  = summary.reduce((s, c) => s + c.ads.mtdOrganicConversions, 0);
    const totalMtdRevenue      = summary.reduce((s, c) => s + c.revenue.mtd, 0);
    const totalMtdRevenuePrior = summary.reduce((s, c) => s + (c.revenue.mtdPrior ?? 0), 0);
    const totalYtdRevenue      = summary.reduce((s, c) => s + c.revenue.ytd, 0);
    const totalYtdRevenuePrior = summary.reduce((s, c) => s + (c.revenue.ytdPrior ?? 0), 0);

    // Portfolio ROAS
    const portfolioMtdRoas = totalMtdSpend > 0 && totalMtdRevenue > 0
      ? Math.round((totalMtdRevenue / totalMtdSpend) * 100) / 100 : null;
    const portfolioYtdRoas = totalYtdSpend > 0 && totalYtdRevenue > 0
      ? Math.round((totalYtdRevenue / totalYtdSpend) * 100) / 100 : null;

    // Growing/flat/declining based on YoY ad spend
    const growing   = summary.filter(c => (c.ads.yoyChange ?? 0) > 5).length;
    const declining = summary.filter(c => (c.ads.yoyChange ?? 0) < -5).length;
    const flat      = summary.length - growing - declining;

    res.json({
      totals: {
        mtdSpend: totalMtdSpend,
        momChange: pct(totalMtdSpend, totalMomSpend),
        yoyChange: pct(totalMtdSpend, totalYoySpend),
        ytdSpend: totalYtdSpend,
        ytdChange: pct(totalYtdSpend, totalYtdSpendPrior),
        totalLeads,
        totalSessions,
        totalOrganicSessions,
        organicSessionsMoMChange: pct(totalOrganicSessions, totalMomOrganicSessions),
        organicSessionsYoYChange: pct(totalOrganicSessions, totalYoyOrganicSessions),
        totalOrganicConversions,
        mtdRevenue: totalMtdRevenue,
        mtdRevenueChange: pct(totalMtdRevenue, totalMtdRevenuePrior),
        ytdRevenue: totalYtdRevenue,
        ytdRevenueChange: pct(totalYtdRevenue, totalYtdRevenuePrior),
        portfolioMtdRoas,
        portfolioYtdRoas,
        clientCount: clients.length,
        growing,
        flat,
        declining,
      },
      clients: summary,
    });
  });

  // ─── Documents ─────────────────────────────────────────────────────────
  app.get("/api/documents", (_req, res) => {
    const docs = storage.getDocuments().map((d) => ({
      ...d,
      extractedText: undefined,
      chunks: undefined,
    }));
    res.json(docs);
  });

  app.post("/api/documents", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const id = uuidv4();
    const now = new Date().toISOString();
    const doc = storage.createDocument({
      id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedAt: now,
      uploadedBy: (req.body.uploadedBy as string) || "admin",
      description: (req.body.description as string) || null,
      extractedText: null,
      chunks: null,
      status: "processing",
    });
    res.json({ ...doc, extractedText: undefined, chunks: undefined });
    setImmediate(async () => {
      try {
        const filePath = path.join(UPLOADS_DIR, req.file!.filename);
        const text = await extractTextFromFile(filePath, req.file!.mimetype);
        const chunkArr = chunkText(text);
        storage.updateDocument(id, {
          extractedText: text.slice(0, 50000),
          chunks: JSON.stringify(chunkArr.map((chunk, index) => ({ chunk, index }))),
          status: "ready",
        });
      } catch {
        storage.updateDocument(id, { status: "error" });
      }
    });
  });

  app.delete("/api/documents/:id", (req, res) => {
    const doc = storage.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    try {
      const fp = path.join(UPLOADS_DIR, doc.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
    storage.deleteDocument(req.params.id);
    res.json({ ok: true });
  });

  // ─── Chat ──────────────────────────────────────────────────────────────
  app.get("/api/chat/:sessionId", (req, res) => {
    res.json(storage.getChatMessages(req.params.sessionId, 60));
  });

  app.delete("/api/chat/:sessionId", (req, res) => {
    storage.clearChatSession(req.params.sessionId);
    res.json({ ok: true });
  });

  app.post("/api/chat/:sessionId", async (req, res) => {
    const { query, managerId, dashboardData, managerName } = req.body as {
      query: string;
      managerId?: string;
      dashboardData?: any;
      managerName?: string;
    };
    if (!query?.trim()) return res.status(400).json({ error: "No query provided" });
    const creds = storage.getCredentials().find((c) => c.service === "claude");
    if (!creds) {
      return res.status(400).json({
        error: "Claude API key not configured. Add it in Settings → AI Assistant.",
      });
    }
    const sessionId = req.params.sessionId;
    const now = new Date().toISOString();
    storage.addChatMessage({
      sessionId, managerId: managerId || null, role: "user",
      content: query,
      contextSnapshot: dashboardData ? JSON.stringify(dashboardData).slice(0, 2000) : null,
      sourcesUsed: null, createdAt: now,
    });
    const history = storage.getChatMessages(sessionId, 20).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const historyWithoutLast = history.slice(0, -1);
    try {
      const { reply, sourcesUsed } = await chat({
        messages: historyWithoutLast, query, dashboardData, managerName, apiKey: creds.key,
      });
      const assistantMsg = storage.addChatMessage({
        sessionId, managerId: managerId || null, role: "assistant",
        content: reply, contextSnapshot: null,
        sourcesUsed: sourcesUsed.length ? JSON.stringify(sourcesUsed) : null,
        createdAt: new Date().toISOString(),
      });
      res.json({ message: assistantMsg, sourcesUsed });
    } catch (e: any) {
      const errMsg = storage.addChatMessage({
        sessionId, managerId: managerId || null, role: "assistant",
        content: `Sorry, I ran into an error: ${e.message}`,
        contextSnapshot: null, sourcesUsed: null,
        createdAt: new Date().toISOString(),
      });
      res.status(500).json({ error: e.message, message: errMsg });
    }
  });

  // ─── API Credentials ────────────────────────────────────────────────────
  app.get("/api/credentials", (_req, res) => {
    const creds = storage.getCredentials().map((c) => ({
      ...c,
      key: c.key.slice(0, 4) + "••••••••" + c.key.slice(-4),
    }));
    res.json(creds);
  });

  app.post("/api/credentials", (req, res) => {
    const cred = storage.upsertCredential({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ ...cred, key: cred.key.slice(0, 4) + "••••••••" + cred.key.slice(-4) });
  });

  // ── TEMP: credential discovery endpoints (remove after use) ──────────────────
  app.get("/api/admin/discover/google", async (_req, res) => {
    try {
      const creds = storage.getCredentials();
      const googleOAuth = creds.find(c => c.service === "google_oauth")?.key;
      if (!googleOAuth) return res.status(400).json({ error: "Missing google_oauth credential" });
      const [clientId, clientSecret, refreshToken] = googleOAuth.split("|");
      const { getGoogleAccessToken } = await import("./connectors/google.js");
      const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);
      const axios = (await import("axios")).default;
      // List all GA4 properties via Analytics Admin API
      const ga4 = await axios.get(
        "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
        { headers: { Authorization: `Bearer ${accessToken}` }, params: { pageSize: 200 } }
      );
      res.json({ ga4: ga4.data });
    } catch(e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });

  app.get("/api/admin/discover/meta", async (_req, res) => {
    try {
      const token = storage.getCredentials().find(c => c.service === "meta_token")?.key;
      if (!token) return res.status(400).json({ error: "No meta token" });
      const axios = (await import("axios")).default;
      const r = await axios.get(
        `https://graph.facebook.com/v19.0/me/adaccounts`,
        { params: { fields: "id,name,account_status", limit: 200, access_token: token } }
      );
      res.json(r.data);
    } catch(e: any) {
      res.status(500).json({ error: e.message, details: e.response?.data });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  return httpServer;
}
