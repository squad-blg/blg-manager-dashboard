import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import fs from "fs";
import path from "path";

// ─── Text extraction ────────────────────────────────────────────────────────

export async function extractTextFromFile(
  filePath: string,
  mimeType: string
): Promise<string> {
  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv" ||
    mimeType.startsWith("text/")
  ) {
    return fs.readFileSync(filePath, "utf-8");
  }

  // Fallback: try to read as utf-8
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ─── Chunking ────────────────────────────────────────────────────────────────

export function chunkText(
  text: string,
  chunkSize = 800,
  overlap = 100
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

// ─── Simple keyword retrieval (no vector DB needed) ──────────────────────────
// Scores each chunk by term frequency of query keywords

export function retrieveRelevantChunks(
  query: string,
  allChunks: Array<{ docId: string; docName: string; chunk: string; index: number }>,
  topK = 5
): Array<{ docId: string; docName: string; chunk: string; score: number }> {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = allChunks.map((c) => {
    const text = c.chunk.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const matches = (text.match(new RegExp(`\\b${term}\\b`, "g")) || []).length;
      score += matches;
    }
    return { ...c, score };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Load all document chunks from DB ────────────────────────────────────────

export function getAllChunks() {
  const docs = storage.getDocuments().filter((d) => d.status === "ready" && d.chunks);
  const all: Array<{ docId: string; docName: string; chunk: string; index: number }> = [];
  for (const doc of docs) {
    try {
      const parsed: Array<{ chunk: string; index: number }> = JSON.parse(doc.chunks!);
      for (const c of parsed) {
        all.push({ docId: doc.id, docName: doc.originalName, chunk: c.chunk, index: c.index });
      }
    } catch {
      // skip malformed
    }
  }
  return all;
}

// ─── Build context summary from dashboard data ───────────────────────────────

export function buildDataContext(dashboardData: any, managerName?: string): string {
  if (!dashboardData) return "No dashboard data available.";

  const { totals, clients } = dashboardData;
  const scope = managerName ? `${managerName}'s portfolio` : "all clients";

  let ctx = `## Live Dashboard Data (${scope})\n`;
  ctx += `- MTD Revenue: ${safeMoney(totals.mtdRevenue)} (${totals.mtdRevenueChange != null ? (totals.mtdRevenueChange > 0 ? "+" : "") + totals.mtdRevenueChange + "% MoM" : "no prior data"})\n`;
  ctx += `- YTD Revenue: ${safeMoney(totals.ytdRevenue)} (${totals.ytdRevenueChange != null ? (totals.ytdRevenueChange > 0 ? "+" : "") + totals.ytdRevenueChange + "% YoY" : "no prior data"})\n`;
  ctx += `- Total Leads: ${safeNum(totals.totalLeads)}\n`;
  ctx += `- Total Ad Spend: ${safeMoney(totals.totalAdSpend)}\n`;
  ctx += `- Active Clients: ${totals.clientCount}\n\n`;

  ctx += `## Client Breakdown\n`;
  for (const { client, revenue, analytics } of clients) {
    ctx += `### ${client.name} (${client.platform}${client.location ? ` · ${client.location}` : ""})\n`;
    ctx += `- MTD Rev: ${safeMoney(revenue?.mtd)}`;
    if (revenue.mtdChange !== null) ctx += ` (${revenue.mtdChange > 0 ? "+" : ""}${revenue.mtdChange}% MoM)`;
    ctx += `\n- YTD Rev: ${safeMoney(revenue?.ytd)}`;
    if (revenue.ytdChange !== null) ctx += ` (${revenue.ytdChange > 0 ? "+" : ""}${revenue.ytdChange}% YoY)`;
    ctx += `\n- Leads: ${analytics?.leads ?? "—"} | Ad Spend: ${safeMoney(analytics?.adSpend)} | CPL: ${safeMoney(analytics?.costPerLead)} | Sessions: ${safeNum(analytics?.sessions)}\n`;
  }

  return ctx;
}

// ─── Main chat function ──────────────────────────────────────────────────────

export async function chat(params: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  query: string;
  dashboardData: any;
  managerName?: string;
  apiKey: string;
}): Promise<{ reply: string; sourcesUsed: string[] }> {
  const { messages, query, dashboardData, managerName, apiKey } = params;

  const client = new Anthropic({ apiKey });

  // Retrieve relevant document chunks
  const allChunks = getAllChunks();
  const relevantChunks = allChunks.length > 0
    ? retrieveRelevantChunks(query, allChunks, 6)
    : [];

  const sourcesUsed = [...new Set(relevantChunks.map((c) => c.docId))];

  // Build the system prompt
  const dataCtx = buildDataContext(dashboardData, managerName);

  let docCtx = "";
  if (relevantChunks.length > 0) {
    docCtx = "\n\n## Trusted Reference Documents\n";
    for (const chunk of relevantChunks) {
      docCtx += `\n### From: ${chunk.docName}\n${chunk.chunk}\n`;
    }
  }

  const systemPrompt = `You are the BestLyfe Group (BLG) Agency Intelligence Assistant — an AI analyst embedded in the agency's manager dashboard.

Your role is to help Digital Marketing Managers (DMMs) understand their client data, identify trends, flag issues, and answer questions grounded in both live data and BLG's own trusted internal documents.

**Rules:**
1. Always ground your answers in the data and documents provided. Do not fabricate numbers.
2. If the answer isn't in the data or documents, say so clearly — do not guess.
3. Be concise and direct. DMMs are busy — lead with the key insight, then support it.
4. When referencing a specific number, cite it from the data (e.g., "Rockin Bounce is down 14.7% YoY").
5. If a question is about a client not in the current filtered view, mention that the data may not be visible and suggest they switch filters.
6. Use markdown for structure when the response benefits from it (bullet lists, headers, bold).
7. Today's date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
8. Current scope: ${managerName ? `${managerName}'s clients only` : "all clients across all managers"}.

${dataCtx}${docCtx}`;

  // Build conversation history for Claude (last 10 turns)
  const history = messages.slice(-10).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [...history, { role: "user", content: query }],
  });

  const reply =
    response.content[0].type === "text" ? response.content[0].text : "(No response)";

  return { reply, sourcesUsed };
}
