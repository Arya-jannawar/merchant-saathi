import type { SqliteDatabase } from "@/lib/db";
import { getNow, isClockInjected, istParts, lastCompleteAfternoonWindow, previousAfternoonWindow } from "@/lib/clock";
import { loadFixture, type Fixture } from "@/lib/fixture";
import { seedMerchant, resetMerchantById, deleteMerchantById, DEFAULT_VARIANT_SEED } from "@/lib/seed";
import { averageOrderValuePaise, completedAfternoonTotals, completedTotalsInRange, afternoonBands, salesDeltaPct } from "@/domain/metrics";
import { getAudience } from "@/domain/consent";
import { getAiMode } from "@/adapters/ai";

export const MAX_MERCHANTS_PER_SESSION = 6;

export interface MerchantListItem {
  id: string;
  name: string;
  fixtureVersion: string;
  isDefault: boolean;
}

export function listMerchants(db: SqliteDatabase, sessionId: string): MerchantListItem[] {
  const rows = db
    .prepare(
      "SELECT id, variant_seed, display_name, fixture_version FROM merchants WHERE demo_session_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(sessionId) as { id: string; variant_seed: number; display_name: string; fixture_version: string }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    fixtureVersion: r.fixture_version,
    isDefault: r.variant_seed === DEFAULT_VARIANT_SEED,
  }));
}

/**
 * Resolve which of the session's OWN merchants a request talks to. The
 * requested id comes from the client but is only honored when it belongs to
 * this session - cross-session ids return not_found without leaking existence.
 */
export function resolveMerchant(
  db: SqliteDatabase,
  sessionId: string,
  requestedMerchantId?: string | null
): { merchantId: string; merchants: MerchantListItem[] } | { merchantId: null; merchants: MerchantListItem[] } {
  const merchants = listMerchants(db, sessionId);
  if (requestedMerchantId) {
    const owned = merchants.find((m) => m.id === requestedMerchantId);
    if (!owned) throw new MerchantNotFoundError();
    return { merchantId: owned.id, merchants };
  }
  return { merchantId: merchants[0]?.id ?? null, merchants };
}

export class MerchantNotFoundError extends Error {
  constructor() {
    super("Merchant not found for this session.");
  }
}

export function createMerchant(
  db: SqliteDatabase,
  sessionId: string,
  displayName?: string
): MerchantListItem {
  const existing = listMerchants(db, sessionId);
  if (existing.length >= MAX_MERCHANTS_PER_SESSION) {
    throw new MerchantLimitError();
  }
  const variantSeed = DEFAULT_VARIANT_SEED + (existing.length + 1) * 7919;
  const fixture = loadFixture();
  const id = seedMerchant(db, sessionId, { variantSeed, displayName, fixture });
  return {
    id,
    name:
      displayName?.trim() ||
      (db.prepare("SELECT display_name FROM merchants WHERE id = ?").get(id) as { display_name: string }).display_name,
    fixtureVersion: fixture.fixtureVersion,
    isDefault: false,
  };
}

export class MerchantLimitError extends Error {
  constructor() {
    super(`This demo session can hold up to ${MAX_MERCHANTS_PER_SESSION} businesses.`);
  }
}

export function removeMerchant(db: SqliteDatabase, sessionId: string, merchantId: string): void {
  deleteMerchantById(db, sessionId, merchantId);
}

export function resetActiveMerchant(
  db: SqliteDatabase,
  sessionId: string,
  requestedMerchantId: string | null | undefined,
  fixtureVersion: "bakery-v1" | "bakery-thin-v1" = "bakery-v1"
): { fixtureVersion: string; merchantName: string } {
  const fixture = loadFixture(fixtureVersion);
  // No active business yet -> seed the default one (first-visit "Load sample data").
  const resolved = resolveMerchant(db, sessionId, requestedMerchantId);
  if (!resolved.merchantId) {
    const id = seedMerchant(db, sessionId, { fixture });
    return { fixtureVersion: fixture.fixtureVersion, merchantName: merchantDisplayName(db, id) };
  }
  const { merchantId, displayName } = resetMerchantById(db, sessionId, resolved.merchantId, fixture);
  return { fixtureVersion: fixture.fixtureVersion, merchantName: displayName };
}

function merchantDisplayName(db: SqliteDatabase, merchantId: string): string {
  return (db.prepare("SELECT display_name FROM merchants WHERE id = ?").get(merchantId) as { display_name: string })
    .display_name;
}

export function ensureTenant(db: SqliteDatabase, sessionId: string): string {
  const existing = db
    .prepare("SELECT id FROM merchants WHERE demo_session_id = ? ORDER BY created_at ASC, id ASC")
    .get(sessionId) as { id: string } | undefined;
  if (existing) return existing.id;
  return seedMerchant(db, sessionId, {});
}

export function resolveTenant(db: SqliteDatabase, sessionId: string, requestedMerchantId?: string | null): string {
  const resolved = resolveMerchant(db, sessionId, requestedMerchantId);
  if (resolved.merchantId) return resolved.merchantId;
  return seedMerchant(db, sessionId, {});
}

export interface DemoState {
  seeded: boolean;
  sessionId: string;
  merchants: MerchantListItem[];
  activeMerchantId: string | null;
  merchant?: { name: string; fixtureVersion: string; timezone: string; currency: string };
  nowIso: string;
  clockInjected: boolean;
  aiMode: "fixture" | "live";
  kpis?: {
    previous: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    current: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    ordersDeltaPct: number | null;
    salesDeltaPct: number | null;
  };
  audience?: { eligible: number; excluded: number; channel: string };
  hint?: string;
}

export function getDemoState(
  db: SqliteDatabase,
  sessionId: string,
  requestedMerchantId?: string | null
): DemoState {
  const fixture = loadFixture();
  const now = getNow();
  const resolved = resolveMerchant(db, sessionId, requestedMerchantId);
  const merchants = resolved.merchants;
  const base = {
    seeded: merchants.length > 0,
    sessionId,
    merchants,
    activeMerchantId: resolved.merchantId,
    nowIso: now.toISOString(),
    clockInjected: isClockInjected(),
    aiMode: getAiMode(),
  };

  if (!resolved.merchantId) {
    return { ...base, hint: "Load the sample data to explore the demo bakery." };
  }
  const merchantId = resolved.merchantId;
  const merchant = db
    .prepare("SELECT * FROM merchants WHERE id = ? AND demo_session_id = ?")
    .get(merchantId, sessionId) as
    | { id: string; display_name: string; fixture_version: string; timezone: string; currency: string }
    | undefined;

  if (!merchant) {
    return { ...base, hint: "Load the sample data to explore the demo bakery." };
  }

  const currWin = lastCompleteAfternoonWindow(now);
  const prevWin = previousAfternoonWindow(currWin);
  const prev = completedAfternoonTotals(db, merchantId, prevWin);
  const curr = completedAfternoonTotals(db, merchantId, currWin);
  const audience = getAudience(db, merchantId, fixture.customers.channel);

  return {
    ...base,
    merchant: {
      name: merchant.display_name,
      fixtureVersion: merchant.fixture_version,
      timezone: merchant.timezone,
      currency: merchant.currency,
    },
    kpis: {
      previous: {
        label: prevWin.label,
        orders: prev.orders,
        netSalesPaise: prev.netSalesPaise,
        aovPaise: averageOrderValuePaise(prev),
      },
      current: {
        label: currWin.label,
        orders: curr.orders,
        netSalesPaise: curr.netSalesPaise,
        aovPaise: averageOrderValuePaise(curr),
      },
      ordersDeltaPct: salesDeltaPct(curr.orders, prev.orders),
      salesDeltaPct: salesDeltaPct(curr.netSalesPaise, prev.netSalesPaise),
    },
    audience: {
      eligible: audience.eligibleIds.length,
      excluded: audience.excluded.length,
      channel: fixture.customers.channel,
    },
  };
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface InsightsDay {
  dayLabel: string;
  orders: number;
  netSalesPaise: number;
}

export interface DemoInsights {
  merchantId: string;
  merchantName: string;
  nowIso: string;
  windowLabels: { previous: string; current: string };
  days: {
    previous: InsightsDay[];
    current: InsightsDay[];
  };
  funnel: {
    customers: number;
    eligible: number;
    queued: number | null;
    redemptions: number | null;
    contributionPaise: number | null;
    simulated: true;
  } | null;
}

/**
 * One-glance dashboard facts, all computed from order/consent/campaign rows:
 * per-day 3-6 p.m. totals for both windows, and the campaign funnel for the
 * latest queued campaign (stages are null when that step has not happened).
 */
export function getDemoInsights(db: SqliteDatabase, merchantId: string, now: Date): DemoInsights {
  const fixture = loadFixture();
  const merchant = db.prepare("SELECT display_name FROM merchants WHERE id = ?").get(merchantId) as
    | { display_name: string }
    | undefined;

  const currWin = lastCompleteAfternoonWindow(now);
  const prevWin = previousAfternoonWindow(currWin);
  const daySeries = (window: { startIso: string }): InsightsDay[] =>
    afternoonBands(window.startIso).map((band) => {
      const totals = completedTotalsInRange(db, merchantId, band.startIso, band.endIso);
      const weekday = WEEKDAY_LABELS[istParts(new Date(band.startIso)).weekday];
      return { dayLabel: weekday, orders: totals.orders, netSalesPaise: totals.netSalesPaise };
    });

  // Funnel from the latest campaign of this merchant (any status; later stages
  // stay null until the corresponding step actually happened).
  const camp = db
    .prepare("SELECT id, version, status, audience_count FROM campaigns WHERE merchant_id = ? ORDER BY created_at DESC, version DESC LIMIT 1")
    .get(merchantId) as { id: string; version: number; status: string; audience_count: number } | undefined;
  const audience = getAudience(db, merchantId, fixture.customers.channel);
  const customers = (db.prepare("SELECT COUNT(*) AS n FROM customers WHERE merchant_id = ?").get(merchantId) as { n: number }).n;

  let funnel: DemoInsights["funnel"] = null;
  if (camp) {
    const outboxRow = db
      .prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ? AND version = ?")
      .get(camp.id, camp.version) as { n: number };
    const redRow = db
      .prepare(
        "SELECT COUNT(DISTINCT event_id) AS n, COALESCE(SUM(amount_paise),0) AS amt FROM redemptions WHERE campaign_id = ?"
      )
      .get(camp.id) as { n: number; amt: number };
    const costRow = db.prepare("SELECT offer_json FROM campaigns WHERE id = ? AND version = ?").get(camp.id, camp.version) as
      | { offer_json: string }
      | undefined;
    let contribution: number | null = null;
    if (camp.status === "queued" && costRow) {
      const offer = JSON.parse(costRow.offer_json) as { bundleCostPaise: number | null };
      const qty = (db.prepare("SELECT COALESCE(SUM(quantity),0) AS q FROM redemptions WHERE campaign_id = ?").get(camp.id) as { q: number }).q;
      contribution = offer.bundleCostPaise === null ? null : redRow.amt - qty * offer.bundleCostPaise;
    }
    funnel = {
      customers,
      eligible: audience.eligibleIds.length,
      queued: camp.status === "queued" ? outboxRow.n : null,
      redemptions: camp.status === "queued" ? redRow.n : null,
      contributionPaise: contribution,
      simulated: true,
    };
  }

  return {
    merchantId,
    merchantName: merchant?.display_name ?? "this business",
    nowIso: now.toISOString(),
    windowLabels: { previous: prevWin.label, current: currWin.label },
    days: { previous: daySeries(prevWin), current: daySeries(currWin) },
    funnel,
  };
}
