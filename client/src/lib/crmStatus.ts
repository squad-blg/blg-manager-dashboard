/**
 * crmStatus.ts
 *
 * Single source of truth for "is the CRM connected for this client?".
 *
 * The server doesn't return a `crmConnected` boolean. Instead, each client in
 * the /api/dashboard response carries a `missingCredentials` map. A CRM is
 * considered connected when none of the CRM-specific keys appear in that map.
 * This mirrors the inference pattern already used inline at Dashboard.tsx:521.
 *
 * Keep this logic in one place so the conditional render in Dashboard.tsx and
 * any future per-client view stay consistent.
 */

const CRM_CREDENTIAL_KEYS = [
  "ersFolder",
  "ersApiKey",
  "ersDevKey",
  "ioApiKey",
] as const;

export interface ClientLike {
  client: { platform: string };
  revenue?: { mtd?: number; ytd?: number };
  missingCredentials?: Record<string, string>;
}

/** True if the client has any CRM credential present (i.e., we expect real revenue). */
export function isCrmConnected(c: ClientLike): boolean {
  const missing = c.missingCredentials ?? {};
  return !CRM_CREDENTIAL_KEYS.some((k) => k in missing);
}

/**
 * Decide which revenue treatment to render.
 *
 *   "real"      -> show the measured number from c.revenue
 *   "estimated" -> use the proxy formula (CRM never connected)
 *   "empty"     -> CRM connected but no revenue in the period (legitimate zero)
 */
export function revenueDisplayMode(c: ClientLike): "real" | "estimated" | "empty" {
  if (!isCrmConnected(c)) return "estimated";
  const mtd = c.revenue?.mtd ?? 0;
  const ytd = c.revenue?.ytd ?? 0;
  if (mtd > 0 || ytd > 0) return "real";
  return "empty";
}
