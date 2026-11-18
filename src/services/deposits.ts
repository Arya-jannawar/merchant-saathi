/**
 * Deposit collection via a sandboxed Payment-Link simulator: the merchant
 * records an order + deposit, gets a labeled link, and a simulated success
 * event persists once. A repeated callback can never double-collect, and the
 * remaining balance is always order - deposits collected.
 */

import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@/lib/db";
import { withTransaction } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getNow } from "@/lib/clock";

export interface DepositRequestDto {
  id: string;
  orderRef: string;
  description: string;
  orderPaise: number;
  depositPaise: number;
  remainingPaise: number;
  status: "pending" | "collected";
  linkId: string;
  createdAt: string;
  collectedAt: string | null;
}

function toDto(row: Record<string, unknown>): DepositRequestDto {
  const depositPaise = Number(row.deposit_paise);
  return {
    id: String(row.id),
    orderRef: String(row.order_ref),
    description: String(row.description),
    orderPaise: Number(row.order_paise),
    depositPaise,
    remainingPaise: Number(row.order_paise) - (row.status === "collected" ? depositPaise : 0),
    status: row.status === "collected" ? "collected" : "pending",
    linkId: String(row.link_id),
    createdAt: String(row.created_at),
    collectedAt: (row.collected_at as string | null) ?? null,
  };
}

export async function createDeposit(
  db: SqliteDatabase,
  merchantId: string,
  input: { orderRef: string; description: string; orderPaise: number; depositPct: number },
): Promise<DepositRequestDto> {
  if (input.orderPaise <= 0) throw new ApiError("invalid_input", "Order value must be a positive amount.");
  if (input.depositPct <= 0 || input.depositPct > 100) throw new ApiError("invalid_input", "Deposit rate must be 1-100 percent.");
  const depositPaise = Math.round((input.orderPaise * input.depositPct) / 100);
  const now = getNow().toISOString();
  const id = `dep_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const linkId = `pl_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withTransaction(db, async () => {
    await db.prepare(
      "INSERT INTO deposit_requests (id, merchant_id, order_ref, description, order_paise, deposit_paise, status, link_id, created_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
    ).run(id, merchantId, input.orderRef, input.description, input.orderPaise, depositPaise, linkId, now);
  });
  const row = (await db.prepare("SELECT * FROM deposit_requests WHERE id = ?").get(id)) as Record<string, unknown>;
  return toDto(row);
}

/**
 * Simulated success callback. Idempotent by design: the first call flips
 * pending -> collected and records one ledger payment event; every later call
 * returns the same receipt with duplicate: true and touches nothing.
 */
export async function collectDeposit(db: SqliteDatabase, merchantId: string, depositId: string): Promise<{ deposit: DepositRequestDto; duplicate: boolean }> {
  const row = (await db
    .prepare("SELECT * FROM deposit_requests WHERE merchant_id = ? AND id = ?")
    .get(merchantId, depositId)) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError("not_found", "Deposit request not found for this session.");
  if (row.status === "collected") {
    return { deposit: toDto(row), duplicate: true };
  }
  const now = getNow().toISOString();
  await withTransaction(db, async () => {
    await db.prepare("UPDATE deposit_requests SET status = 'collected', collected_at = ? WHERE id = ?").run(now, depositId);
    await db.prepare(
      `INSERT INTO ledger_events (id, merchant_id, batch_id, external_id, event_type, occurred_on, amount_paise, method, note, sku_id, units, unit_cost_paise, source, fingerprint, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      `led_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      merchantId,
      `dep:${String(row.id)}`,
      String(row.link_id),
      "payment",
      now,
      Number(row.deposit_paise),
      "upi",
      `Deposit for order ${String(row.order_ref)} (sandbox payment link)`,
      null,
      null,
      null,
      "deposit-link",
      `dep:${String(row.link_id)}`,
      now,
    );
  });
  const updated = (await db.prepare("SELECT * FROM deposit_requests WHERE id = ?").get(depositId)) as Record<string, unknown>;
  return { deposit: toDto(updated), duplicate: false };
}

export async function listDeposits(db: SqliteDatabase, merchantId: string): Promise<DepositRequestDto[]> {
  const rows = (await db
    .prepare("SELECT * FROM deposit_requests WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(merchantId)) as Record<string, unknown>[];
  return rows.map(toDto);
}
