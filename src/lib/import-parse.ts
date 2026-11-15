/**
 * Transaction-file parsing for "Plan my next sale" (pure functions, no DB).
 *
 * Supported input: CSV, TSV and JSON arrays of transaction rows. Column names
 * are auto-mapped from common statement headers, amounts accept Indian digit
 * grouping and currency symbols, and every value normalizes to integer paise
 * with a classified event type. Nothing here touches the database - preview
 * and confirm are separate stages so no ledger mutation happens before an
 * explicit confirmation.
 */

import { createHash } from "node:crypto";

export type LedgerEventType = "sale" | "payment" | "refund" | "fee" | "settlement" | "transfer";

export interface ParsedRow {
  rowNumber: number;
  occurredAt: string; // ISO timestamp (date + optional time, IST)
  eventType: LedgerEventType;
  amountPaise: number; // always the magnitude; the type carries direction
  method: string | null;
  note: string | null;
  externalId: string | null;
  units: number | null;
  unitCostPaise: number | null;
  status: "import" | "skip-duplicate" | "skip-cancelled" | "conflict";
  reason: string | null;
}

export interface ParseResult {
  delimiter: "," | "\t";
  rows: ParsedRow[];
  periodStart: string | null;
  periodEnd: string | null;
  checksum: string;
  unsupportedReason: string | null;
}

export type DateOrder = "auto" | "dmy" | "mdy" | "ymd";

const CANON = {
  date: ["date", "txn date", "transaction date", "order date", "payment date", "settlement date", "occurred on"],
  time: ["time", "txn time", "transaction time", "order time"],
  amount: ["amount", "total", "net amount", "txn amount", "transaction amount", "value", "paid amount", "order value"],
  type: ["type", "txn type", "transaction type", "status", "description", "remarks", "narration", "particulars"],
  method: ["method", "mode", "payment method", "channel", "instrument", "payment mode"],
  note: ["note", "notes", "comment", "comments", "item", "product", "details"],
  externalId: ["id", "ref", "reference", "order id", "txn id", "transaction id", "utr", "external id", "order reference"],
  units: ["units", "qty", "quantity", "items"],
  unitCost: ["unit cost", "cost", "cogs", "item cost", "cost price", "unit price cost"],
  sku: ["sku", "sku id", "product id", "item id"],
  credit: ["credit", "cr amount", "credit amount"],
  debit: ["debit", "dr amount", "debit amount"],
};

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
}

function mapHeaders(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (const [canon, names] of Object.entries(CANON)) {
    for (const h of headers) {
      if (names.includes(normalizeHeader(h)) && idx[canon] === undefined) idx[canon] = headers.indexOf(h);
    }
  }
  return idx;
}

/** Split a delimited line honoring double-quoted fields (RFC-4180 style). */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Amount parsing: handles "1,25,000.50", "₹125.50", "Rs 125.5", "125.50",
 * "-74.50", "(125.50)" (accounting negative), whitespace. Returns paise.
 */
export function parseAmountToPaise(raw: string): number | null {
  let t = raw.replace(/^\uFEFF/, "").trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (/^-/.test(t)) {
    negative = true;
    t = t.replace(/^-+/, "");
  }
  // Strip the currency prefix and Indian digit grouping - but keep the
  // decimal point (an earlier version stripped it and broke paise math).
  t = t.replace(/^(?:inr|rs\.?)\s*/i, "").replace(/[₹\s]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  const paise = Math.round(parseFloat(t) * 100);
  return negative ? -paise : paise;
}

/** Date parsing with explicit ambiguity handling. Returns ISO (IST, +05:30). */
export function parseDateToIso(raw: string, time: string | null, dateOrder: DateOrder): string | null {
  const t = raw.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slash = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    y = Number(slash[3]);
    // Explicit orders win; "auto" assumes Indian DD/MM unless the first
    // number cannot be a day.
    if (dateOrder === "mdy" || (dateOrder === "auto" && a <= 12 && b > 12)) {
      d = a;
      m = b;
    } else {
      d = b;
      m = a;
    }
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let hh = 0;
  let mm = 0;
  if (time) {
    const tm = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (tm) {
      hh = Number(tm[1]);
      mm = Number(tm[2]);
      const ap = tm[4]?.toLowerCase();
      if (ap === "pm" && hh < 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
    }
  }
  // Build the IST instant directly (+05:30 fixed, matching the app clock).
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

function classify(
  typeCell: string | null,
  noteCell: string | null,
  signedPaise: number,
  creditCol: number | null,
  debitCol: number | null,
  cells: string[]
): { eventType: LedgerEventType; cancelled: boolean } {
  const haystack = `${typeCell ?? ""} ${noteCell ?? ""}`.toLowerCase();
  if (/\b(cancel|canceled|cancelled|void)\b/.test(haystack)) return { eventType: "sale", cancelled: true };
  const has = (re: RegExp) => re.test(haystack);
  let eventType: LedgerEventType = "sale";
  if (has(/refund|return\b/)) eventType = "refund";
  else if (has(/fee|charge|commission|gst\b|platform/)) eventType = "fee";
  else if (has(/settlement|payout|utr\b/)) eventType = "settlement";
  else if (has(/transfer/)) eventType = "transfer";
  else if (has(/payment|collected|deposit/)) eventType = "payment";
  else if (signedPaise < 0) eventType = "refund";
  else if (debitCol !== null && Number.parseFloat((cells[debitCol] ?? "0").replace(/[^\d.]/g, "")) > 0) eventType = "fee";
  else if (creditCol !== null) eventType = "sale";
  return { eventType, cancelled: false };
}

export interface ParseInput {
  content: string;
  dateOrder?: DateOrder;
}

export function parseStatement({ content, dateOrder = "auto" }: ParseInput): ParseResult {
  const cleaned = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return emptyResult(null, "The uploaded file is empty.");
  if (cleaned.startsWith("[") || cleaned.startsWith("{")) return parseJsonRows(cleaned);

  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  const delimiter: "," | "\t" = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const headerCells = splitDelimited(lines[0], delimiter).map(normalizeHeader);
  const idx = mapHeaders(headerCells);
  if (idx.date === undefined || (idx.amount === undefined && idx.credit === undefined && idx.debit === undefined)) {
    return emptyResult(delimiter, "Could not find a date column and an amount column. Check the header row or use the sample template.");
  }

  const rows: ParsedRow[] = [];
  const fingerprints: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delimiter);
    const get = (canon: keyof typeof CANON) => (idx[canon] !== undefined ? cells[idx[canon]]?.trim() ?? "" : "");
    const occurredAt = parseDateToIso(get("date"), idx.time !== undefined ? get("time") : null, dateOrder);
    const amountRaw = idx.amount !== undefined ? get("amount") : get("credit") || get("debit") || "0";
    const amountPaise = parseAmountToPaise(amountRaw);
    const note = get("note") || get("type") || null;
    const method = get("method") || null;
    const externalId = get("externalId") || null;
    const units = idx.units !== undefined ? Number.parseInt(get("units"), 10) : null;
    const unitCostPaise = idx.unitCost !== undefined ? parseAmountToPaise(get("unitCost")) : null;
    const rowNumber = i + 1;

    if (occurredAt === null || amountPaise === null || amountPaise === 0) {
      rows.push({
        rowNumber, occurredAt: get("date"), eventType: "sale", amountPaise: amountPaise ?? 0, method, note, externalId,
        units: Number.isFinite(units) ? units : null, unitCostPaise, status: "conflict",
        reason: occurredAt === null ? "Unreadable date" : "Unreadable or zero amount",
      });
      continue;
    }
    const signed = idx.credit !== undefined && idx.debit === undefined && idx.amount === undefined ? amountPaise : amountPaise;
    const { eventType, cancelled } = classify(get("type"), note, signed, idx.credit ?? null, idx.debit ?? null, cells);
    if (cancelled) {
      rows.push({
        rowNumber, occurredAt, eventType, amountPaise: Math.abs(signed), method, note, externalId,
        units: Number.isFinite(units) ? units : null, unitCostPaise,
        status: "skip-cancelled", reason: "Cancelled order - no effect on totals",
      });
      continue;
    }
    const magnitude = Math.abs(signed);
    const fingerprint = fingerprintFor(occurredAt, eventType, magnitude, externalId, note);
    rows.push({
      rowNumber, occurredAt, eventType, amountPaise: magnitude, method, note, externalId,
      units: Number.isFinite(units) ? units : null, unitCostPaise,
      status: "import", reason: null,
    });
    fingerprints.push(fingerprint);
  }

  // In-file duplicate detection (same fingerprint twice) - keep the first.
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status !== "import") continue;
    const fp = fingerprintFor(row.occurredAt, row.eventType, row.amountPaise, row.externalId, row.note);
    if (seen.has(fp)) {
      row.status = "skip-duplicate";
      row.reason = "Duplicate of an earlier row in this file";
    } else seen.add(fp);
  }

  const importedDates = rows.filter((r) => r.status === "import").map((r) => r.occurredAt).sort();
  const checksum = createHash("sha256").update(cleaned).digest("hex").slice(0, 24);
  return {
    delimiter,
    rows,
    periodStart: importedDates[0] ?? null,
    periodEnd: importedDates[importedDates.length - 1] ?? null,
    checksum,
    unsupportedReason: null,
  };
}

export function fingerprintFor(occurredAt: string, eventType: string, amountPaise: number, externalId: string | null, note: string | null): string {
  // Strong external ids dominate; otherwise the canonical event tuple is the
  // identity. Two genuine cash sales at the same minute stay distinct only
  // when their notes differ - matching the spec's duplicate-handling rules.
  if (externalId) return createHash("sha256").update(`id:${externalId}`).digest("hex");
  return createHash("sha256")
    .update(`ev:${occurredAt}|${eventType}|${amountPaise}|${note ?? ""}`)
    .digest("hex");
}

interface JsonRow {
  date?: string; occurredOn?: string; time?: string;
  amount?: number | string; type?: string; method?: string; note?: string;
  externalId?: string; id?: string; units?: number; unitCost?: number | string; sku?: string;
}

function parseJsonRows(content: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return emptyResult(null, "The file is neither valid JSON nor a delimited statement.");
  }
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { transactions?: JsonRow[] }).transactions ?? null);
  if (!Array.isArray(arr)) return emptyResult(null, 'JSON input must be an array or a "transactions" field.');
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i] as JsonRow;
    const rowNumber = i + 2;
    const occurredAt = parseDateToIso(String(item.date ?? item.occurredOn ?? ""), item.time ?? null, "auto");
    const amountPaise = typeof item.amount === "number" ? Math.round(item.amount * 100) : parseAmountToPaise(String(item.amount ?? ""));
    if (!occurredAt || amountPaise === null || amountPaise === 0) {
      rows.push({
        rowNumber, occurredAt: String(item.date ?? ""), eventType: "sale", amountPaise: 0, method: item.method ?? null,
        note: item.note ?? null, externalId: item.externalId ?? item.id ?? null,
        units: item.units ?? null, unitCostPaise: item.unitCost !== undefined ? parseAmountToPaise(String(item.unitCost)) : null,
        status: "conflict", reason: "Unreadable date or amount",
      });
      continue;
    }
    const { eventType, cancelled } = classify(item.type ?? null, item.note ?? null, amountPaise, null, null, []);
    const magnitude = Math.abs(amountPaise);
    const fp = fingerprintFor(occurredAt, eventType, magnitude, item.externalId ?? item.id ?? null, item.note ?? null);
    if (cancelled) {
      rows.push({
        rowNumber, occurredAt, eventType, amountPaise: magnitude, method: item.method ?? null, note: item.note ?? null,
        externalId: item.externalId ?? item.id ?? null, units: item.units ?? null,
        unitCostPaise: item.unitCost !== undefined ? parseAmountToPaise(String(item.unitCost)) : null,
        status: "skip-cancelled", reason: "Cancelled order - no effect on totals",
      });
      continue;
    }
    const dup = seen.has(fp);
    seen.add(fp);
    rows.push({
      rowNumber, occurredAt, eventType, amountPaise: magnitude, method: item.method ?? null, note: item.note ?? null,
      externalId: item.externalId ?? item.id ?? null, units: item.units ?? null,
      unitCostPaise: item.unitCost !== undefined ? parseAmountToPaise(String(item.unitCost)) : null,
      status: dup ? "skip-duplicate" : "import", reason: dup ? "Duplicate of an earlier row in this file" : null,
    });
  }
  const importedDates = rows.filter((r) => r.status === "import").map((r) => r.occurredAt).sort();
  const checksum = createHash("sha256").update(content).digest("hex").slice(0, 24);
  return { delimiter: ",", rows, periodStart: importedDates[0] ?? null, periodEnd: importedDates.at(-1) ?? null, checksum, unsupportedReason: null };
}

function emptyResult(delimiter: "," | "\t" | null, reason: string): ParseResult {
  return {
    delimiter: (delimiter ?? ",") as "," | "\t",
    rows: [],
    periodStart: null,
    periodEnd: null,
    checksum: createHash("sha256").update(String(reason)).digest("hex").slice(0, 24),
    unsupportedReason: reason,
  };
}
