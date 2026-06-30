import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, asc } from "drizzle-orm";
import * as schema from "../shared/schema";

// Store DB in /app/data on Railway (persisted via volume), fallback to local for dev
const DB_PATH = process.env.NODE_ENV === "production" ? "/app/data/blg-dashboard.db" : "blg-dashboard.db";
import fs from "fs";
if (process.env.NODE_ENV === "production") {
  fs.mkdirSync("/app/data", { recursive: true });
}
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite, { schema });

// Auto-migrate tables — base schema kept in sync with shared/schema.ts
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
    ers_dev_key TEXT,
    io_account_id TEXT,
    io_api_key TEXT,
    aaa_campaign_id TEXT,
    ecomm_platform TEXT,
    google_ads_customer_id TEXT,
    ga4_property_id TEXT,
    meta_ad_account_id TEXT,
    location TEXT,
    active INTEGER DEFAULT 1,
    last_touch_date TEXT,
    last_touch_note TEXT,
    sheets_spreadsheet_id TEXT,
    sheets_cell TEXT
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
    google_ad_spend REAL,
    meta_ad_spend REAL,
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

// Additive migrations for existing deployments that have the old schema
// These are safe to run repeatedly — they no-op if the column already exists
const migrations = [
  `ALTER TABLE clients ADD COLUMN last_touch_date TEXT`,
  `ALTER TABLE clients ADD COLUMN last_touch_note TEXT`,
  `ALTER TABLE clients ADD COLUMN io_api_key TEXT`,
  `ALTER TABLE clients ADD COLUMN google_ads_customer_id TEXT`,
  `ALTER TABLE clients ADD COLUMN ga4_property_id TEXT`,
  `ALTER TABLE clients ADD COLUMN meta_ad_account_id TEXT`,
  `ALTER TABLE clients ADD COLUMN ers_dev_key TEXT`,
  `ALTER TABLE clients ADD COLUMN sheets_spreadsheet_id TEXT`,
  `ALTER TABLE clients ADD COLUMN sheets_cell TEXT`,
  `ALTER TABLE analytics_snapshots ADD COLUMN google_ad_spend REAL`,
  `ALTER TABLE analytics_snapshots ADD COLUMN meta_ad_spend REAL`,
  `ALTER TABLE clients ADD COLUMN agency_analytics_url TEXT`,
  `ALTER TABLE clients ADD COLUMN io_location_id TEXT`,
  `ALTER TABLE clients ADD COLUMN ghl_location_id TEXT`,
  `ALTER TABLE clients ADD COLUMN ghl_api_key TEXT`,
  `ALTER TABLE analytics_snapshots ADD COLUMN organic_sessions INTEGER`,
  `ALTER TABLE analytics_snapshots ADD COLUMN organic_conversions INTEGER`,
];
for (const sql of migrations) {
  try { sqlite.exec(sql); } catch { /* column already exists */ }
}

// Purge demo data once — real syncs always use real timestamps
try {
  const purged = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'demo_data_purged'").get() as { key: string } | undefined;
  if (!purged) {
    sqlite.exec(`DELETE FROM revenue_snapshots`);
    sqlite.exec(`DELETE FROM analytics_snapshots`);
    sqlite.prepare("INSERT OR REPLACE INTO api_credentials (id, service, key, label, updated_at) VALUES ('demo_data_purged', 'system', '1', 'Demo data purged', datetime('now'))").run();
    console.log('[startup] Demo data purged — all snapshot tables cleared.');
  }
} catch (e: any) {
  console.error('[startup] Demo data purge error:', e.message);
}

// Seed default managers if empty
const managerCount = sqlite.prepare("SELECT COUNT(*) as count FROM managers").get() as { count: number };
if (managerCount.count === 0) {
  sqlite.exec(`
    INSERT INTO managers (id, name, email, color) VALUES ('jarvis', 'Jarvis Gatlin', 'jarvis@bestlyfegroup.com', '#7DC242');
    INSERT INTO managers (id, name, email, color) VALUES ('jan', 'Jan Feterman', 'jan@bestlyfegroup.com', '#4A8C1C');
    INSERT INTO managers (id, name, email, color) VALUES ('adriana', 'Adriana Zedan', 'adriana@bestlyfegroup.com', '#F59E0B');
  `);
}

// One-time data fixes — idempotent, tracked via api_credentials flag
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v1'").get();
  if (!fixed) {
    // Fix Adriana's last name (Zendan → Zedan)
    sqlite.prepare("UPDATE managers SET name = 'Adriana Zedan' WHERE id = 'adriana' AND name = 'Adriana Zendan'").run();
    // Trim A&G cross-references from client display names
    sqlite.prepare("UPDATE clients SET name = 'A&G' WHERE name = 'A&G (Rockin Bouncies)'").run();
    sqlite.prepare("UPDATE clients SET name = 'Rockin Bouncies' WHERE name = 'Rockin Bouncies (A&G)'").run();
    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v1', 'system', '1', 'Data fix v1 applied', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v1 applied — manager name + client names corrected.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v1 error:', e.message);
}

// Data fix v2 — flag A&G as LEADGEN (leads-based account, no e-commerce revenue CRM)
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v2'").get();
  if (!fixed) {
    sqlite.prepare("UPDATE clients SET platform = 'LEADGEN' WHERE name = 'A&G' AND platform != 'LEADGEN'").run();
    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v2', 'system', '1', 'Data fix v2 applied', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v2 applied — A&G platform set to LEADGEN.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v2 error:', e.message);
}

// Data fix v4 — mark SEO-only clients with platform = 'SEO'
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v4'").get();
  if (!fixed) {
    const seoClients = [
      'CSE Services', 'Curlys', 'Foundation Event Rentals', 'GA Supreme Remodeling',
      "Granny's Rentals", 'Renfaye Lashes', 'Scrub Cleaning Company', 'Jump City',
      'LightXP', 'All Fun Bouncing Inflatables',
    ];
    const stmt = sqlite.prepare("UPDATE clients SET platform = 'SEO' WHERE name = ?");
    for (const name of seoClients) stmt.run(name);
    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v4', 'system', '1', 'Data fix v4 applied', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v4 applied — 10 clients set to SEO platform.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v4 error:', e.message);
}

// Data fix v3 — store GHL credentials for 1858 (survey submits as lead source)
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v3'").get();
  if (!fixed) {
    sqlite.prepare(
      "UPDATE clients SET ghl_location_id = 'Dv35qx82aEeO3TDRDRSO', ghl_api_key = 'pit-42d6c6cd-56c6-4f38-a444-9d995ed7becf' WHERE name = '1858'"
    ).run();
    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v3', 'system', '1', 'Data fix v3 applied', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v3 applied — 1858 GHL credentials set.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v3 error:', e.message);
}

// Data fix v5 — store GHL credentials for 9 additional LEADGEN clients
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v5'").get();
  if (!fixed) {
    const ghlClients: Array<{ name: string; locationId: string; apiKey: string }> = [
      { name: 'Good Morning Remodel',                  locationId: 'Hprid4vTaJ1nRJWl3EWU', apiKey: 'pit-04f09ad9-96c7-49ce-8b8f-31d23d637eff' },
      { name: 'Legacy Construction and Remodeling',    locationId: '76SngQvFfw5a5AxNER3U', apiKey: 'pit-521e1eb9-73dc-4912-9f75-e3d1ee765c7c' },
      { name: 'Michael James Remodeling',              locationId: 'pyBQC8mJPeFK4BkQmxQZ', apiKey: 'pit-d0de8975-35a7-445e-ae7a-b6480e0962c3' },
      { name: 'Natural Stone Services',                locationId: 'nf54irdjlaBLVKq2Y1NH', apiKey: 'pit-11aa1770-92aa-4814-a69f-72d5949963f6' },
      { name: 'Peak Academic Coaching',                locationId: 'DBzqpvA1PXZCW7TFWa1j', apiKey: 'pit-48c296a1-766a-4f04-82d3-db376693fc39' },
      { name: 'Renfaye Lashes',                        locationId: 'awam0z7pIk6NlDZGULx7', apiKey: 'pit-a7ee9740-893e-4b45-903f-8a07abae6b16' },
      { name: 'Southern Stoneworks',                   locationId: 'bWpsYndNV8k0AQPeGQop', apiKey: 'pit-6a758b17-a49e-4d35-8547-c8c057effc7a' },
      { name: 'Zoom Room Fort Mill',                   locationId: '1h4cB1Nhie9X8LhjZ0Se', apiKey: 'pit-19deb63b-8330-47a6-9a5e-2f1414bfa8d6' },
      { name: 'Zoom Room Sandy Springs',               locationId: '3xbXzKxo1V49EnmUAo8s', apiKey: 'pit-ee090f68-9d49-4f75-8707-b6d5251e0412' },
    ];
    const stmt = sqlite.prepare("UPDATE clients SET ghl_location_id = ?, ghl_api_key = ? WHERE name = ?");
    for (const c of ghlClients) stmt.run(c.locationId, c.apiKey, c.name);
    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v5', 'system', '1', 'Data fix v5 applied — 9 GHL clients wired', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v5 applied — GHL credentials set for 9 LEADGEN clients.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v5 error:', e.message);
}

// Data fix v6 — add Arianna as manager and reassign clients per June 2026 portfolio restructure
try {
  const fixed = sqlite.prepare("SELECT key FROM api_credentials WHERE id = 'data_fix_v6'").get();
  if (!fixed) {
    // Add Arianna if not already present
    const ariannaExists = sqlite.prepare("SELECT id FROM managers WHERE id = 'arianna'").get();
    if (!ariannaExists) {
      sqlite.prepare(
        "INSERT INTO managers (id, name, email, color) VALUES ('arianna', 'Arianna', 'arianna@bestlyfegroup.com', '#8B5CF6')"
      ).run();
    }

    // Jarvis → Jan
    const toJan = ['Bounce Orlando', 'Bounce Universe Party Rentals'];
    const stmtJan = sqlite.prepare("UPDATE clients SET managerId = 'jan' WHERE name = ?");
    for (const name of toJan) stmtJan.run(name);

    // Jarvis → Adriana
    const toAdriana = ['Funtime Services', 'Party Rentals R Us', 'All Fun Bouncing Inflatables'];
    const stmtAdriana = sqlite.prepare("UPDATE clients SET managerId = 'adriana' WHERE name = ?");
    for (const name of toAdriana) stmtAdriana.run(name);

    // Adriana → Arianna
    const adrianaToArianna = ['Acadiana Inflatables', 'CSE Services', 'Curlys', 'Just-A-Jumpin', 'Renfaye Lashes'];
    const stmtArianna = sqlite.prepare("UPDATE clients SET managerId = 'arianna' WHERE name = ?");
    for (const name of adrianaToArianna) stmtArianna.run(name);

    // Jan → Arianna
    const janToArianna = ['Blue Line Inflatables and Events', 'Sacramento Party Jumps', 'Bounce USA'];
    for (const name of janToArianna) stmtArianna.run(name);

    sqlite.prepare(
      "INSERT INTO api_credentials (id, service, key, label, updated_at) VALUES ('data_fix_v6', 'system', '1', 'Data fix v6 applied — Arianna added, 10 clients reassigned', datetime('now'))"
    ).run();
    console.log('[startup] Data fix v6 applied — Arianna manager created, 10 clients reassigned.');
  }
} catch (e: any) {
  console.error('[startup] Data fix v6 error:', e.message);
}

export interface IStorage {
  getManagers(): schema.Manager[];
  getManager(id: string): schema.Manager | undefined;
  getClients(managerId?: string): schema.Client[];
  getClient(id: string): schema.Client | undefined;
  createClient(data: schema.InsertClient): schema.Client;
  updateClient(id: string, data: Partial<schema.InsertClient>): schema.Client | undefined;
  deleteClient(id: string): void;
  getRevenueSnapshots(clientId: string, periodType: string): schema.RevenueSnapshot[];
  upsertRevenueSnapshot(data: schema.InsertRevenueSnapshot): schema.RevenueSnapshot;
  getAnalyticsSnapshots(clientId: string, periodType: string): schema.AnalyticsSnapshot[];
  upsertAnalyticsSnapshot(data: schema.InsertAnalyticsSnapshot): schema.AnalyticsSnapshot;
  getDocuments(): schema.Document[];
  getDocument(id: string): schema.Document | undefined;
  createDocument(data: schema.InsertDocument): schema.Document;
  updateDocument(id: string, data: Partial<schema.InsertDocument>): schema.Document | undefined;
  deleteDocument(id: string): void;
  getChatMessages(sessionId: string, limit?: number): schema.ChatMessage[];
  addChatMessage(data: schema.InsertChatMessage): schema.ChatMessage;
  clearChatSession(sessionId: string): void;
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
      return db.select().from(schema.clients).where(eq(schema.clients.managerId, managerId)).orderBy(asc(schema.clients.name)).all();
    }
    return db.select().from(schema.clients).orderBy(asc(schema.clients.name)).all();
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
