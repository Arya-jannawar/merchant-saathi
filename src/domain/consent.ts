import { createHash } from "node:crypto";
import type { SqliteDatabase } from "@/lib/db";

/**
 * Consent filtering. Audience membership comes only from the demo consent
 * register - never inferred from payment records. Contact details stay out of
 * AI requests entirely.
 */

export interface AudienceResult {
  eligibleIds: string[];
  excluded: { customerId: string; reason: string }[];
  hash: string;
}

export function hashAudience(sortedIds: string[]): string {
  return createHash("sha256").update(sortedIds.join("|")).digest("hex");
}

export function getAudience(db: SqliteDatabase, merchantId: string, channel: string): AudienceResult {
  const rows = db
    .prepare(
      "SELECT cu.id AS customer_id, c.status AS consent_status FROM customers cu LEFT JOIN consents c ON c.customer_id = cu.id AND c.channel = ? WHERE cu.merchant_id = ? ORDER BY cu.id"
    )
    .all(channel, merchantId) as { customer_id: string; consent_status: string | null }[];

  const eligibleIds: string[] = [];
  const excluded: { customerId: string; reason: string }[] = [];
  for (const row of rows) {
    if (row.consent_status === "active") eligibleIds.push(row.customer_id);
    else
      excluded.push({
        customerId: row.customer_id,
        reason: row.consent_status === "revoked" ? "consent revoked" : "no consent on record",
      });
  }
  return { eligibleIds, excluded, hash: hashAudience(eligibleIds) };
}
