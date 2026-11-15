/**
 * Import pipeline service: preview (no writes) -> explicit confirm (atomic
 * post + batch receipt) -> history / batch reversal. Everything is
 * merchant-scoped through resolveTenant; fingerprints dedupe across batches
 * and exact-file retries are a no-op ("0 imported"), never an error.
 */

import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@/lib/db";
import { withTransaction } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getNow } from "@/lib/clock";
import { parseStatement, fingerprintFor, type ParseResult, type ParsedRow } from "@/lib/import-parse";

export interface ImportPreview {
  batchToken: string;
  filename: string;
  checksum: string;
  delimiter: "," | "\t";
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  alreadyImportedBefore: number;
  periodStart: string | null;
  periodEnd: string | null;
  unsupportedReason: string | null;
  rows: ParsedRow[];
}

/** The ledger rows that a confirmation would actually post (for previews). */
function postableRows(
  db: SqliteDatabase,
  merchantId: string,
  parsed: ParseResult,
): (ParsedRow & { duplicateOfLedger: boolean })[] {
  return parsed.rows.filter((r) => r.status === "import").map((r) => ({
    ...r,
    duplicateOfLedger: db
      .prepare("SELECT 1 FROM ledger_events WHERE merchant_id = ? AND fingerprint = ?")
      .get(merchantId, fingerprintFor(r.occurredAt, r.eventType, r.amountPaise, r.externalId, r.note)) !== undefined,
  }));
}

export function previewImport(
  db: SqliteDatabase,
  merchantId: string,
  filename: string,
  content: string,
  dateOrder: "auto" | "dmy" | "mdy" | "ymd",
): ImportPreview {
  const parsed = parseStatement({ content, dateOrder });
  const postable = postableRows(db, merchantId, parsed);
  const counts = (status: ParsedRow["status"]) => parsed.rows.filter((r) => r.status === status).length;
  const previewRows = parsed.rows.map((r) => {
    const dup = r.status === "import" && postable.find((p) => p.rowNumber === r.rowNumber)?.duplicateOfLedger;
    return dup ? { ...r, status: "skip-duplicate" as const, reason: "Already in the ledger (same external id or event tuple)" } : r;
  });
  return {
    batchToken: parsed.checksum,
    filename,
    checksum: parsed.checksum,
    delimiter: parsed.delimiter,
    rowsTotal: parsed.rows.length,
    rowsImported: previewRows.filter((r) => r.status === "import").length,
    rowsSkipped: previewRows.filter((r) => r.status === "skip-duplicate" || r.status === "skip-cancelled").length,
    rowsConflicting: counts("conflict"),
    alreadyImportedBefore: postable.filter((p) => p.duplicateOfLedger).length,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    unsupportedReason: parsed.unsupportedReason,
    rows: previewRows,
  };
}

export interface ImportReceipt {
  batchId: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  periodStart: string | null;
  periodEnd: string | null;
  duplicateBatch: boolean;
}

/** Confirm: parse again server-side, then post every valid row atomically. */
export function confirmImport(
  db: SqliteDatabase,
  merchantId: string,
  filename: string,
  content: string,
  dateOrder: "auto" | "dmy" | "mdy" | "ymd",
): ImportReceipt {
  const parsed = parseStatement({ content, dateOrder });
  if (parsed.unsupportedReason) throw new ApiError("invalid_input", parsed.unsupportedReason);
  const existing = db
    .prepare("SELECT id FROM import_batches WHERE merchant_id = ? AND checksum = ? AND reversed_at IS NULL")
    .get(merchantId, parsed.checksum) as { id: string } | undefined;
  const now = getNow().toISOString();
  const batchId = `imp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const rowsToPost = parsed.rows.filter((r) => r.status === "import");
  let imported = 0;
  let skipped = parsed.rows.filter((r) => r.status === "skip-duplicate" || r.status === "skip-cancelled").length;
  let conflicting = parsed.rows.filter((r) => r.status === "conflict").length;

  withTransaction(db, () => {
    if (existing) {
      // Exact-file retry: fingerprints dedupe to zero new rows; still return
      // the original receipt shape with duplicateBatch marked.
      const prior = db
        .prepare("SELECT rows_total, rows_imported, rows_skipped, rows_conflicting, period_start, period_end FROM import_batches WHERE id = ?")
        .get(existing.id) as { rows_total: number; rows_imported: number; rows_skipped: number; rows_conflicting: number; period_start: string | null; period_end: string | null };
      db.prepare("UPDATE import_batches SET created_at = ? WHERE id = ?").run(now, batchId);
      db.prepare(
        "INSERT INTO import_batches (id, merchant_id, filename, checksum, rows_total, rows_imported, rows_skipped, rows_conflicting, period_start, period_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(batchId, merchantId, filename, parsed.checksum, prior.rows_total, 0, prior.rows_total, 0, prior.period_start, prior.period_end, now);
      return;
    }
    for (const row of rowsToPost) {
      const fp = fingerprintFor(row.occurredAt, row.eventType, row.amountPaise, row.externalId, row.note);
      const dup = db
        .prepare("SELECT 1 FROM ledger_events WHERE merchant_id = ? AND fingerprint = ?")
        .get(merchantId, fp);
      if (dup) {
        skipped += 1;
        continue;
      }
      db.prepare(
        `INSERT INTO ledger_events (id, merchant_id, batch_id, external_id, event_type, occurred_on, amount_paise, method, note, sku_id, units, unit_cost_paise, source, fingerprint, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        `led_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        merchantId,
        batchId,
        row.externalId,
        row.eventType,
        row.occurredAt,
        row.amountPaise,
        row.method,
        row.note,
        null,
        row.units,
        row.unitCostPaise,
        "import",
        fp,
        now,
      );
      imported += 1;
    }
    const importedDates = rowsToPost.map((r) => r.occurredAt).sort();
    db.prepare(
      "INSERT INTO import_batches (id, merchant_id, filename, checksum, rows_total, rows_imported, rows_skipped, rows_conflicting, period_start, period_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(batchId, merchantId, filename, parsed.checksum, parsed.rows.length, imported, skipped, conflicting, importedDates[0] ?? null, importedDates.at(-1) ?? null, now);
  });

  const receipt = db
    .prepare("SELECT * FROM import_batches WHERE merchant_id = ? AND id = ?")
    .get(merchantId, batchId) as {
    id: string; filename: string; rows_total: number; rows_imported: number; rows_skipped: number; rows_conflicting: number; period_start: string | null; period_end: string | null;
  };
  return {
    batchId: receipt.id,
    filename: receipt.filename,
    rowsTotal: receipt.rows_total,
    rowsImported: receipt.rows_imported,
    rowsSkipped: receipt.rows_skipped,
    rowsConflicting: receipt.rows_conflicting,
    periodStart: receipt.period_start,
    periodEnd: receipt.period_end,
    duplicateBatch: Boolean(existing),
  };
}

export interface ImportBatchDto {
  id: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  reversedAt: string | null;
}

export function listBatches(db: SqliteDatabase, merchantId: string): ImportBatchDto[] {
  const rows = db
    .prepare("SELECT * FROM import_batches WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(merchantId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    filename: String(r.filename),
    rowsTotal: Number(r.rows_total),
    rowsImported: Number(r.rows_imported),
    rowsSkipped: Number(r.rows_skipped),
    rowsConflicting: Number(r.rows_conflicting),
    periodStart: (r.period_start as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    createdAt: String(r.created_at),
    reversedAt: (r.reversed_at as string | null) ?? null,
  }));
}

/** Reverse a confirmed batch: its rows are removed, records confirmed by another batch stay. */
export function revertBatch(db: SqliteDatabase, merchantId: string, batchId: string): { reversed: boolean } {
  const batch = db
    .prepare("SELECT id FROM import_batches WHERE merchant_id = ? AND id = ? AND reversed_at IS NULL")
    .get(merchantId, batchId) as { id: string } | undefined;
  if (!batch) throw new ApiError("not_found", "Import batch not found for this session (or already reversed).");
  withTransaction(db, () => {
    db.prepare("DELETE FROM ledger_events WHERE merchant_id = ? AND batch_id = ?").run(merchantId, batchId);
    db.prepare("UPDATE import_batches SET reversed_at = ? WHERE id = ?").run(getNow().toISOString(), batchId);
  });
  return { reversed: true };
}
