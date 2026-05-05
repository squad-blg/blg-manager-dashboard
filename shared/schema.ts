import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Managers
export const managers = sqliteTable("managers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  color: text("color").notNull(), // hex for avatar/badge
});

export const insertManagerSchema = createInsertSchema(managers);
export type InsertManager = z.infer<typeof insertManagerSchema>;
export type Manager = typeof managers.$inferSelect;

// Platform types
export type PlatformType = "ERS" | "IO" | "ECOMM" | "LEADGEN";

// Clients
export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  managerId: text("manager_id").notNull(),
  platform: text("platform").notNull(), // ERS | IO | ECOMM | LEADGEN
  ersFolder: text("ers_folder"),   // ERS folder/subdomain (e.g. "rockinbounce")
  ersApiKey: text("ers_api_key"),   // ERS API Token (from Admin > API Info)
  ersDevKey: text("ers_dev_key"),   // ERS Developer API Key (from Admin > API Keys)
  ioAccountId: text("io_account_id"),
  ioApiKey: text("io_api_key"),
  aaaCampaignId: text("aaa_campaign_id"), // Agency Analytics campaign ID
  ecommPlatform: text("ecomm_platform"), // shopify | woocommerce | etc
  // Google Ads + GA4
  googleAdsCustomerId: text("google_ads_customer_id"), // 10-digit customer ID, digits only
  ga4PropertyId: text("ga4_property_id"),              // GA4 numeric property ID
  // Meta Ads
  metaAdAccountId: text("meta_ad_account_id"),         // act_XXXXXXXXX
  location: text("location"), // city/state
  active: integer("active", { mode: "boolean" }).default(true),
  lastTouchDate: text("last_touch_date"), // ISO date string YYYY-MM-DD
  lastTouchNote: text("last_touch_note"), // optional note about the touch
});

export const insertClientSchema = createInsertSchema(clients).omit({ id: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// Revenue snapshots (cached from API calls, stored daily)
export const revenueSnapshots = sqliteTable("revenue_snapshots", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull(),
  period: text("period").notNull(), // "2026-04" for monthly, "2026" for yearly
  periodType: text("period_type").notNull(), // "month" | "year"
  revenue: real("revenue").notNull(),
  orderCount: integer("order_count"),
  fetchedAt: text("fetched_at").notNull(),
});

export const insertRevenueSnapshotSchema = createInsertSchema(revenueSnapshots).omit({ id: true });
export type InsertRevenueSnapshot = z.infer<typeof insertRevenueSnapshotSchema>;
export type RevenueSnapshot = typeof revenueSnapshots.$inferSelect;

// Analytics snapshots (from Agency Analytics)
export const analyticsSnapshots = sqliteTable("analytics_snapshots", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull(),
  period: text("period").notNull(),
  periodType: text("period_type").notNull(),
  sessions: integer("sessions"),
  conversions: integer("conversions"),
  conversionRate: real("conversion_rate"),
  impressions: integer("impressions"),
  clicks: integer("clicks"),
  adSpend: real("ad_spend"),
  costPerLead: real("cost_per_lead"),
  leads: integer("leads"),
  fetchedAt: text("fetched_at").notNull(),
});

export const insertAnalyticsSnapshotSchema = createInsertSchema(analyticsSnapshots).omit({ id: true });
export type InsertAnalyticsSnapshot = z.infer<typeof insertAnalyticsSnapshotSchema>;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;

// Trusted source documents (uploaded by admin, used as RAG context)
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by"), // e.g. "admin" or manager id
  description: text("description"),
  // Full extracted text (chunked for retrieval)
  extractedText: text("extracted_text"),
  // JSON array of { chunk: string, index: number }
  chunks: text("chunks"),
  status: text("status").notNull().default("processing"), // processing | ready | error
});

export const insertDocumentSchema = createInsertSchema(documents);
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// Chat messages (stored per session/manager)
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(), // managerId or "all"
  managerId: text("manager_id"), // which manager's filter was active
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  contextSnapshot: text("context_snapshot"), // JSON — what data was visible
  sourcesUsed: text("sources_used"), // JSON array of doc IDs referenced
  createdAt: text("created_at").notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// API credentials (global, per integration)
export const apiCredentials = sqliteTable("api_credentials", {
  id: text("id").primaryKey(),
  service: text("service").notNull(), // "agency_analytics" | "ers" | "io"
  key: text("key").notNull(),
  label: text("label"),
  updatedAt: text("updated_at").notNull(),
});

export const insertApiCredentialSchema = createInsertSchema(apiCredentials);
export type InsertApiCredential = z.infer<typeof insertApiCredentialSchema>;
export type ApiCredential = typeof apiCredentials.$inferSelect;
