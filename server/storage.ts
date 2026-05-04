import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../shared/schema";

const sqlite = new Database("blg-dashboard.db");
export const db = drizzle(sqlite, { schema });

// Auto-migrate tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS managers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    ers_folder TEXT,
    ers_api_key TEXT,
    io_account_id TEXT,
    aaa_campaign_id TEXT,
    ecomm_platform TEXT,
    location TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS revenue_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    period TEXT NOT NULL,
    period_type TEXT NOT NULL,
    revenue REAL NOT NULL,
    order_count INTEGER,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    period TEXT NOT NULL,
    period_type TEXT NOT NULL,
    sessions INTEGER,
    conversions INTEGER,
    conversion_rate REAL,
    impressions INTEGER,
    clicks INTEGER,
    ad_spend REAL,
    cost_per_lead REAL,
    leads INTEGER,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL,
    uploaded_by TEXT,
    description TEXT,
    extracted_text TEXT,
    chunks TEXT,
    status TEXT NOT NULL DEFAULT 'processing'
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    manager_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    context_snapshot TEXT,
    sources_used TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_credentials (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT,
    updated_at TEXT NOT NULL
  );
`);

// Migrations — add columns if they don't exist yet
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN last_touch_date TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN last_touch_note TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN io_api_key TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN google_ads_customer_id TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN ga4_property_id TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE clients ADD COLUMN meta_ad_account_id TEXT`); } catch {}

// Seed default data if empty
const managerCount = sqlite.prepare("SELECT COUNT(*) as count FROM managers").get() as { count: number };
if (managerCount.count === 0) {
  sqlite.exec(`
    INSERT INTO managers VALUES ('jarvis', 'Jarvis Gatlin', 'jarvis@bestlyfegroup.com', '#7DC242');
    INSERT INTO managers VALUES ('jan', 'Jan Feterman', 'jan@bestlyfegroup.com', '#4A8C1C');
    INSERT INTO managers VALUES ('adriana', 'Adriana Zendan', 'adriana@bestlyfegroup.com', '#F59E0B');

    -- Sample clients — replace with real client data
    INSERT INTO clients VALUES ('client-01', 'Rockin Bounce', 'jarvis', 'ERS', 'rockinbounce', NULL, NULL, NULL, NULL, 'Lakeland, FL', 1, '2026-04-10', 'Monthly check-in call');
    INSERT INTO clients VALUES ('client-02', 'A&G Tent', 'jarvis', 'ERS', 'aandgtent', NULL, NULL, NULL, NULL, 'Lakeland, FL', 1, '2026-03-28', 'Reviewed spring campaign');
    INSERT INTO clients VALUES ('client-03', 'Jump Zone', 'jan', 'IO', NULL, NULL, 'jz-001', NULL, NULL, 'Sacramento, CA', 1, '2026-04-12', 'Strategy call');
    INSERT INTO clients VALUES ('client-04', 'Bounce Kings', 'jan', 'ERS', 'bouncekings', NULL, NULL, NULL, NULL, 'San Diego, CA', 1, '2026-02-15', NULL);
    INSERT INTO clients VALUES ('client-05', 'Party Palace', 'adriana', 'ECOMM', NULL, NULL, NULL, NULL, 'shopify', 'Greenville, SC', 1, '2026-04-08', 'Onboarding follow-up');
    INSERT INTO clients VALUES ('client-06', 'Event Pro', 'adriana', 'LEADGEN', NULL, NULL, NULL, 'aa-123', NULL, 'Biloxi, MS', 1, '2026-01-20', NULL);
    INSERT INTO clients VALUES ('client-07', 'Bounce World', 'adriana', 'IO', NULL, NULL, 'bw-002', NULL, NULL, 'Knoxville, TN', 1, '2026-03-05', 'Upsell discussion');
    INSERT INTO clients VALUES ('client-08', 'Inflatable Fun', 'jan', 'ERS', 'inflatablefun', NULL, NULL, NULL, NULL, 'Cleveland, GA', 1, '2026-04-01', 'Q1 review');
  `);
}

export interface IStorage {
  // Managers
  getManagers(): schema.Manager[];
  getManager(id: string): schema.Manager | undefined;

  // Clients
  getClients(managerId?: string): schema.Client[];
  getClient(id: string): schema.Client | undefined;
  createClient(data: schema.InsertClient): schema.Client;
  updateClient(id: string, data: Partial<schema.InsertClient>): schema.Client | undefined;
  deleteClient(id: string): void;

  // Revenue snapshots
  getRevenueSnapshots(clientId: string, periodType: string): schema.RevenueSnapshot[];
  upsertRevenueSnapshot(data: schema.InsertRevenueSnapshot): schema.RevenueSnapshot;

  // Analytics snapshots
  getAnalyticsSnapshots(clientId: string, periodType: string): schema.AnalyticsSnapshot[];
  upsertAnalyticsSnapshot(data: schema.InsertAnalyticsSnapshot): schema.AnalyticsSnapshot;

  // Documents
  getDocuments(): schema.Document[];
  getDocument(id: string): schema.Document | undefined;
  createDocument(data: schema.InsertDocument): schema.Document;
  updateDocument(id: string, data: Partial<schema.InsertDocument>): schema.Document | undefined;
  deleteDocument(id: string): void;

  // Chat messages
  getChatMessages(sessionId: string, limit?: number): schema.ChatMessage[];
  addChatMessage(data: schema.InsertChatMessage): schema.ChatMessage;
  clearChatSession(sessionId: string): void;

  // API Credentials
  getCredentials(): schema.ApiCredential[];
  upsertCredential(data: schema.InsertApiCredential): schema.ApiCredential;
}

export class Storage implements IStorage {
  getManagers(): schema.Manager[] {
    return db.select().from(schema.managers).all();
  }

  getManager(id: string): schema.Manager | undefined {
    return db.select().from(schema.managers).where(eq(schema.managers.id, id)).get();
  }

  getClients(managerId?: string): schema.Client[] {
    if (managerId) {
      return db.select().from(schema.clients).where(eq(schema.clients.managerId, managerId)).all();
    }
    return db.select().from(schema.clients).all();
  }

  getClient(id: string): schema.Client | undefined {
    return db.select().from(schema.clients).where(eq(schema.clients.id, id)).get();
  }

  createClient(data: schema.InsertClient): schema.Client {
    const id = `client-${Date.now()}`;
    return db.insert(schema.clients).values({ ...data, id }).returning().get();
  }

  updateClient(id: string, data: Partial<schema.InsertClient>): schema.Client | undefined {
    return db.update(schema.clients).set(data).where(eq(schema.clients.id, id)).returning().get();
  }

  deleteClient(id: string): void {
    db.delete(schema.clients).where(eq(schema.clients.id, id)).run();
  }

  getRevenueSnapshots(clientId: string, periodType: string): schema.RevenueSnapshot[] {
    return db.select().from(schema.revenueSnapshots)
      .where(and(
        eq(schema.revenueSnapshots.clientId, clientId),
        eq(schema.revenueSnapshots.periodType, periodType)
      ))
      .orderBy(desc(schema.revenueSnapshots.period))
      .all();
  }

  upsertRevenueSnapshot(data: schema.InsertRevenueSnapshot): schema.RevenueSnapshot {
    // Check if exists
    const existing = db.select().from(schema.revenueSnapshots)
      .where(and(
        eq(schema.revenueSnapshots.clientId, data.clientId),
        eq(schema.revenueSnapshots.period, data.period),
        eq(schema.revenueSnapshots.periodType, data.periodType)
      )).get();

    if (existing) {
      return db.update(schema.revenueSnapshots)
        .set(data)
        .where(eq(schema.revenueSnapshots.id, existing.id))
        .returning()
        .get()!;
    }
    return db.insert(schema.revenueSnapshots).values(data).returning().get();
  }

  getAnalyticsSnapshots(clientId: string, periodType: string): schema.AnalyticsSnapshot[] {
    return db.select().from(schema.analyticsSnapshots)
      .where(and(
        eq(schema.analyticsSnapshots.clientId, clientId),
        eq(schema.analyticsSnapshots.periodType, periodType)
      ))
      .orderBy(desc(schema.analyticsSnapshots.period))
      .all();
  }

  upsertAnalyticsSnapshot(data: schema.InsertAnalyticsSnapshot): schema.AnalyticsSnapshot {
    const existing = db.select().from(schema.analyticsSnapshots)
      .where(and(
        eq(schema.analyticsSnapshots.clientId, data.clientId),
        eq(schema.analyticsSnapshots.period, data.period),
        eq(schema.analyticsSnapshots.periodType, data.periodType)
      )).get();

    if (existing) {
      return db.update(schema.analyticsSnapshots)
        .set(data)
        .where(eq(schema.analyticsSnapshots.id, existing.id))
        .returning()
        .get()!;
    }
    return db.insert(schema.analyticsSnapshots).values(data).returning().get();
  }

  getDocuments(): schema.Document[] {
    return db.select().from(schema.documents).all();
  }

  getDocument(id: string): schema.Document | undefined {
    return db.select().from(schema.documents).where(eq(schema.documents.id, id)).get();
  }

  createDocument(data: schema.InsertDocument): schema.Document {
    return db.insert(schema.documents).values(data).returning().get();
  }

  updateDocument(id: string, data: Partial<schema.InsertDocument>): schema.Document | undefined {
    return db.update(schema.documents).set(data).where(eq(schema.documents.id, id)).returning().get();
  }

  deleteDocument(id: string): void {
    db.delete(schema.documents).where(eq(schema.documents.id, id)).run();
  }

  getChatMessages(sessionId: string, limit = 50): schema.ChatMessage[] {
    return db.select().from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessionId))
      .orderBy(desc(schema.chatMessages.id))
      .limit(limit)
      .all()
      .reverse();
  }

  addChatMessage(data: schema.InsertChatMessage): schema.ChatMessage {
    return db.insert(schema.chatMessages).values(data).returning().get();
  }

  clearChatSession(sessionId: string): void {
    db.delete(schema.chatMessages).where(eq(schema.chatMessages.sessionId, sessionId)).run();
  }

  getCredentials(): schema.ApiCredential[] {
    return db.select().from(schema.apiCredentials).all();
  }

  upsertCredential(data: schema.InsertApiCredential): schema.ApiCredential {
    const existing = db.select().from(schema.apiCredentials)
      .where(eq(schema.apiCredentials.id, data.id)).get();
    if (existing) {
      return db.update(schema.apiCredentials).set(data)
        .where(eq(schema.apiCredentials.id, data.id)).returning().get()!;
    }
    return db.insert(schema.apiCredentials).values(data).returning().get();
  }
}

export const storage = new Storage();
