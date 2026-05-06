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
import { fetchIOMetrics } from "./connectors/io";

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
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
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
      const m = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, endDate);
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
    if (!client.ioAccountId || !client.ioApiKey) {
      return res.status(400).json({ error: "IO account ID and API key not configured" });
    }
    try {
      const { startDate, endDate } = req.body;
      const metrics = await fetchIOMetrics(client.ioAccountId, client.ioApiKey, startDate, endDate);
      res.json(metrics);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      let sessions = 0;
      if (client.ga4PropertyId) {
        const ga4 = await fetchGA4Metrics(accessToken, client.ga4PropertyId, startDate, endDate);
        sessions = ga4.sessions;
      }
      res.json({ ...adsMetrics, sessions });
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
        endDate
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
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

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
          if (client.platform === "ERS" && client.ersFolder && client.ersApiKey && client.ersDevKey) {
            try {
              const m = await fetchERSMetrics(client.ersFolder, client.ersApiKey, client.ersDevKey, startDate, endDate);
              storage.upsertRevenueSnapshot({ clientId: client.id, period: targetPeriod, periodType: "month", revenue: m.revenue, orderCount: m.orderCount, fetchedAt });
              console.log(`[sync] ${client.name} ERS: orders=${m.orderCount} revenue=$${m.revenue}`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} ERS:`, e.message);
            }
          }

          // ── IO ─────────────────────────────────────────────────────────
          if (client.platform === "IO" && client.ioAccountId && client.ioApiKey) {
            const m = await fetchIOMetrics(client.ioAccountId, client.ioApiKey, startDate, endDate);
            storage.upsertRevenueSnapshot({ clientId: client.id, period: targetPeriod, periodType: "month", revenue: m.revenue, orderCount: m.orderCount, fetchedAt });
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

              let sessions = 0;
              if (client.ga4PropertyId) {
                try {
                  const ga4 = await fetchGA4Metrics(googleAccessToken, client.ga4PropertyId, startDate, endDate);
                  sessions = ga4.sessions;
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
              const m = await fetchMetaAdsMetrics(client.metaAdAccountId, metaCreds.key, startDate, endDate);
              const existing = storage.getAnalyticsSnapshots(client.id, "month").find(s => s.period === targetPeriod);
              // Store Meta spend separately; combine with googleAdSpend for total — no compounding
              const googleSpend = existing?.googleAdSpend ?? 0;
              const totalSpend = Math.round((googleSpend + m.adSpend) * 100) / 100;
              const leads = m.leads;
              storage.upsertAnalyticsSnapshot({
                clientId: client.id, period: targetPeriod, periodType: "month",
                googleAdSpend: googleSpend,
                metaAdSpend: m.adSpend,
                adSpend: totalSpend,
                leads,
                costPerLead: leads > 0 ? Math.round((totalSpend / leads) * 100) / 100 : 0,
                sessions: existing?.sessions ?? 0,
                conversions: existing?.conversions ?? 0,
                conversionRate: existing?.conversionRate ?? 0,
                impressions: existing?.impressions ?? 0,
                clicks: existing?.clicks ?? 0,
                fetchedAt,
              });
              console.log(`[sync] ${client.name} Meta: spend=$${m.adSpend} leads=${leads} (google=$${googleSpend} meta=$${m.adSpend} total=$${totalSpend})`);
            } catch (e: any) {
              console.error(`[sync] ${client.name} Meta:`, e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0,500) : '');
            }
          }
        } catch (e: any) {
          console.error(`[sync] ${client.name} unexpected:`, e.message);
        }
      }
      console.log(`[sync] Period ${targetPeriod} complete.`);
    });
  });

  // ─── Analytics ──────────────────────────────────────────────────────────
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
    const { managerId } = req.query;
    const clients = storage.getClients(managerId as string | undefined);
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevPeriod = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const currentYear = String(now.getFullYear());
    const prevYear = String(now.getFullYear() - 1);

    const summary = clients.map((client) => {
      const monthlyRevenue = storage.getRevenueSnapshots(client.id, "month");
      const yearlyRevenue = storage.getRevenueSnapshots(client.id, "year");
      const analytics = storage.getAnalyticsSnapshots(client.id, "month");

      const mtd = monthlyRevenue.find((r) => r.period === currentPeriod);
      const mtdPrior = monthlyRevenue.find((r) => r.period === prevPeriod);
      const ytd = yearlyRevenue.find((r) => r.period === currentYear);
      const ytdPrior = yearlyRevenue.find((r) => r.period === prevYear);
      const analyticsNow = analytics.find((a) => a.period === currentPeriod);
      const analyticsPrior = analytics.find((a) => a.period === prevPeriod);

      const pct = (a?: number | null, b?: number | null) => {
        if (!a || !b || b === 0) return null;
        return Math.round(((a - b) / b) * 10000) / 100;
      };

      const momChange = pct(mtd?.revenue, mtdPrior?.revenue);
      const yoyChange = pct(ytd?.revenue, ytdPrior?.revenue);

      // Churn risk: derived from revenue trend + last touch recency
      // High risk: YoY down >10% AND last touch >60 days ago
      // Medium risk: YoY down >5% OR last touch >45 days ago
      // Low: otherwise
      const lastTouchDaysAgo = client.lastTouchDate
        ? Math.floor((now.getTime() - new Date(client.lastTouchDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      let churnRisk: "low" | "medium" | "high" = "low";
      if ((yoyChange !== null && yoyChange < -10) && (lastTouchDaysAgo === null || lastTouchDaysAgo > 60)) {
        churnRisk = "high";
      } else if ((yoyChange !== null && yoyChange < -5) || (lastTouchDaysAgo !== null && lastTouchDaysAgo > 45)) {
        churnRisk = "medium";
      }

      const adSpend = analyticsNow?.adSpend ?? 0;
      const adSpendPrior = analyticsPrior?.adSpend ?? 0;
      const adSpendChange = pct(adSpend, adSpendPrior);
      // ROAS = Revenue / Ad Spend (null if no spend)
      const mtdRoas = adSpend > 0 && (mtd?.revenue ?? 0) > 0
        ? Math.round(((mtd?.revenue ?? 0) / adSpend) * 100) / 100
        : null;
      const ytdRoas = (() => {
        // Sum ad spend across all months in current year for YTD ROAS
        const now2 = new Date();
        const ytdSpend = analytics
          .filter(a => a.period.startsWith(String(now2.getFullYear())) && a.period <= currentPeriod)
          .reduce((s, a) => s + (a.adSpend ?? 0), 0);
        return ytdSpend > 0 && (ytd?.revenue ?? 0) > 0
          ? Math.round(((ytd?.revenue ?? 0) / ytdSpend) * 100) / 100
          : null;
      })();

      return {
        client,
        revenue: {
          mtd: mtd?.revenue ?? 0,
          mtdPrior: mtdPrior?.revenue ?? 0,
          mtdChange: momChange,
          ytd: ytd?.revenue ?? 0,
          ytdPrior: ytdPrior?.revenue ?? 0,
          ytdChange: yoyChange,
          history: monthlyRevenue.slice(0, 13).reverse(),
        },
        analytics: {
          sessions: analyticsNow?.sessions ?? 0,
          sessionsPrior: analyticsPrior?.sessions ?? 0,
          sessionsChange: pct(analyticsNow?.sessions, analyticsPrior?.sessions),
          leads: analyticsNow?.leads ?? 0,
          leadsPrior: analyticsPrior?.leads ?? 0,
          leadsChange: pct(analyticsNow?.leads, analyticsPrior?.leads),
          adSpend,
          adSpendPrior,
          adSpendChange,
          costPerLead: analyticsNow?.costPerLead ?? 0,
          conversionRate: analyticsNow?.conversionRate ?? 0,
          mtdRoas,
          ytdRoas,
          history: analytics.slice(0, 13).map(a => {
            const rev = monthlyRevenue.find(r => r.period === a.period)?.revenue ?? 0;
            return {
              ...a,
              roas: (a.adSpend ?? 0) > 0 && rev > 0
                ? Math.round((rev / (a.adSpend ?? 1)) * 100) / 100
                : null,
            };
          }).reverse(),
        },
        health: {
          churnRisk,
          lastTouchDate: client.lastTouchDate ?? null,
          lastTouchNote: client.lastTouchNote ?? null,
          lastTouchDaysAgo,
        },
      };
    });

    // Totals
    const totalMtdRevenue = summary.reduce((s, c) => s + c.revenue.mtd, 0);
    const totalMtdPriorRevenue = summary.reduce((s, c) => s + c.revenue.mtdPrior, 0);
    const totalYtdRevenue = summary.reduce((s, c) => s + c.revenue.ytd, 0);
    const totalYtdPriorRevenue = summary.reduce((s, c) => s + c.revenue.ytdPrior, 0);
    const totalLeads = summary.reduce((s, c) => s + c.analytics.leads, 0);
    const totalAdSpend = summary.reduce((s, c) => s + c.analytics.adSpend, 0);
    const totalAdSpendPrior = summary.reduce((s, c) => s + c.analytics.adSpendPrior, 0);
    const totalSessions = summary.reduce((s, c) => s + c.analytics.sessions, 0);
    // Portfolio ROAS: total MTD revenue / total MTD ad spend
    const portfolioMtdRoas = totalAdSpend > 0 && totalMtdRevenue > 0
      ? Math.round((totalMtdRevenue / totalAdSpend) * 100) / 100
      : null;
    const portfolioYtdRoas = (() => {
      const ytdSpend = summary.reduce((s, c) => s + (c.analytics.ytdRoas !== null ? 0 : 0), 0); // recalc below
      // Use per-client ytdRoas weighted by spend
      const totalYtdSpend = summary.reduce((s, c) => {
        // We need ytd spend — approximate from analytics history
        const now2 = new Date();
        const cp = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}`;
        const clientYtdSpend = c.analytics.history
          .filter((a: any) => typeof a.period === 'string' && a.period.startsWith(String(now2.getFullYear())) && a.period <= cp)
          .reduce((ss: number, a: any) => ss + (a.adSpend ?? 0), 0);
        return s + clientYtdSpend;
      }, 0);
      return totalYtdSpend > 0 && totalYtdRevenue > 0
        ? Math.round((totalYtdRevenue / totalYtdSpend) * 100) / 100
        : null;
    })();

    res.json({
      totals: {
        mtdRevenue: totalMtdRevenue,
        mtdRevenueChange:
          totalMtdPriorRevenue > 0
            ? Math.round(((totalMtdRevenue - totalMtdPriorRevenue) / totalMtdPriorRevenue) * 10000) / 100
            : null,
        ytdRevenue: totalYtdRevenue,
        ytdRevenueChange:
          totalYtdPriorRevenue > 0
            ? Math.round(((totalYtdRevenue - totalYtdPriorRevenue) / totalYtdPriorRevenue) * 10000) / 100
            : null,
        totalLeads,
        totalAdSpend,
        totalAdSpendPrior,
        totalAdSpendChange:
          totalAdSpendPrior > 0
            ? Math.round(((totalAdSpend - totalAdSpendPrior) / totalAdSpendPrior) * 10000) / 100
            : null,
        totalSessions,
        portfolioMtdRoas,
        portfolioYtdRoas,
        clientCount: clients.length,
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

  return httpServer;
}
