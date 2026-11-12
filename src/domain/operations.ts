import type { SqliteDatabase } from "@/lib/db";
import type { Fixture } from "@/lib/fixture";
import { lastCompleteAfternoonWindow } from "@/lib/clock";
import { formatINR } from "@/lib/money";

/**
 * The operations copilot: inventory intelligence computed from real rows.
 *
 * Run-rates come from completed orders in the most recent complete window,
 * campaign draw-down comes from the active campaign's remaining redemption
 * capacity, and every suggestion is plain deterministic arithmetic - the AI
 * may narrate these numbers, never invent them. Advisory only: the copilot
 * never mutates inventory.
 */

export type StockStatus = "out" | "critical" | "low" | "healthy";

export interface StockLine {
  skuId: string;
  skuName: string;
  stock: number;
  /** Units sold per day across the current complete window (1 decimal). */
  dailyRate: number | null;
  /** Days the current stock lasts at that rate (null when no recent sales). */
  daysOfCover: number | null;
  status: StockStatus;
  /** Units the campaign could still consume (bundle components x remaining redemptions). */
  campaignDrawDown: number;
  /** Stock minus the campaign's maximum remaining draw (floor 0). */
  projectedAfterCampaign: number;
  /** Suggested restock units to return to a 14-day cover (0 when healthy). */
  restockUnits: number;
  restockCostPaise: number;
}

export interface ServeBlock {
  consents: { active: number; revoked: number; none: number; channel: string };
  champions: { label: string; demoChannelId: string; units: number; spendPaise: number }[];
}

export interface OperationsInsights {
  merchantId: string;
  merchantName: string;
  windowLabel: string;
  targetCoverDays: number;
  lines: StockLine[];
  restockTotalUnits: number;
  restockTotalCostPaise: number;
  briefing: string[];
  serve: ServeBlock;
}

const TARGET_COVER_DAYS = 14;

export function stockStatus(stock: number, daysOfCover: number | null, campaignDrawDown: number): StockStatus {
  if (stock <= 0) return "out";
  const effective = daysOfCover === null ? Number.POSITIVE_INFINITY : daysOfCover - Math.max(campaignDrawDown, 0) * 0;
  if (daysOfCover !== null && daysOfCover < 4) return "critical";
  if (daysOfCover !== null && daysOfCover < 8) return "low";
  if (stock - campaignDrawDown <= 0) return "critical";
  return "healthy";
}

export function getOperationsInsights(db: SqliteDatabase, merchantId: string, fixture: Fixture, now: Date): OperationsInsights {
  const merchant = db.prepare("SELECT display_name FROM merchants WHERE id = ?").get(merchantId) as
    | { display_name: string }
    | undefined;

  const currWin = lastCompleteAfternoonWindow(now);
  // Run-rate window: the current complete Mon-Fri window's five days.
  const [wy, wm, wd] = currWin.startIso.slice(0, 10).split("-").map(Number);
  void wy; void wm;

  // Units sold per SKU in the current window (any time of day - it is all demand).
  const windowStart = currWin.startIso;
  const dayMs = 86_400_000;
  const windowEnd = new Date(new Date(currWin.startIso).getTime() + 5 * dayMs).toISOString();

  const soldRows = db
    .prepare(
      `SELECT oi.sku_id AS skuId, SUM(oi.quantity) AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.merchant_id = ? AND o.status = 'completed' AND o.occurred_at >= ? AND o.occurred_at < ?
       GROUP BY oi.sku_id`
    )
    .all(merchantId, windowStart, windowEnd) as { skuId: string; units: number }[];
  const soldBySku = new Map(soldRows.map((r) => [r.skuId, r.units]));

  const stockRows = db
    .prepare("SELECT sku_id, quantity, unit_variable_cost_paise FROM inventory WHERE merchant_id = ?")
    .all(merchantId) as { sku_id: string; quantity: number; unit_variable_cost_paise: number | null }[];
  const stockBySku = new Map(stockRows.map((r) => [r.sku_id, r]));

  // Campaign draw-down: the latest campaign (if queued) can still consume
  // bundle components up to its cap.
  const camp = db
    .prepare("SELECT id, status, offer_json FROM campaigns WHERE merchant_id = ? ORDER BY created_at DESC, version DESC LIMIT 1")
    .get(merchantId) as { id: string; status: string; offer_json: string } | undefined;
  const recordedRows = camp
    ? (db
        .prepare(
          "SELECT COALESCE(SUM(quantity), 0) AS q FROM redemptions WHERE campaign_id = ?"
        )
        .get(camp.id) as { q: number })
    : { q: 0 };
  let remainingRedemptions = 0;
  let drawDownBySku = new Map<string, number>();
  if (camp && camp.status === "queued") {
    const offer = JSON.parse(camp.offer_json) as { components: { skuId: string; quantity: number }[]; cap: number };
    remainingRedemptions = Math.max(offer.cap - recordedRows.q, 0);
    drawDownBySku = new Map(
      offer.components.map((c) => [c.skuId, remainingRedemptions * c.quantity] as const)
    );
  }

  const lines: StockLine[] = fixture.skus.map((sku) => {
    const stockRow = stockBySku.get(sku.id);
    const stock = stockRow?.quantity ?? 0;
    const unitCost = stockRow?.unit_variable_cost_paise ?? sku.unitVariableCostPaise;
    const sold = soldBySku.get(sku.id) ?? 0;
    const dailyRate = Math.round((sold / 5) * 10) / 10;
    const daysOfCover = dailyRate > 0 ? Math.round((stock / dailyRate) * 10) / 10 : null;
    const campaignDrawDown = drawDownBySku.get(sku.id) ?? 0;
    const status = stockStatus(stock, daysOfCover, campaignDrawDown);
    const projectedAfterCampaign = Math.max(stock - campaignDrawDown, 0);
    const coverUnits = dailyRate > 0 ? Math.ceil(dailyRate * TARGET_COVER_DAYS) : 0;
    const restockUnits = Math.max(coverUnits - projectedAfterCampaign, 0);
    return {
      skuId: sku.id,
      skuName: sku.name,
      stock,
      dailyRate: dailyRate > 0 ? dailyRate : null,
      daysOfCover,
      status,
      campaignDrawDown,
      projectedAfterCampaign,
      restockUnits,
      restockCostPaise: restockUnits * unitCost,
    };
  });

  const restockTotalUnits = lines.reduce((sum, l) => sum + l.restockUnits, 0);
  const restockTotalCostPaise = lines.reduce((sum, l) => sum + l.restockCostPaise, 0);

  const lowLines = lines
    .filter((l) => l.status !== "healthy")
    .sort((a, b) => (a.daysOfCover ?? 999) - (b.daysOfCover ?? 999));

  const briefing: string[] = [
    `Run-rate is computed from completed orders in ${currWin.label} (${lines.length} SKUs tracked).`,
  ];
  if (lowLines.length === 0) {
    briefing.push(`All ${lines.length} SKUs hold more than ${TARGET_COVER_DAYS} days of cover at the current run-rate. No restock needed right now.`);
  } else {
    briefing.push(
      `${lowLines.length} SKU${lowLines.length === 1 ? "" : "s"} need attention before the next weekend: ` +
        lowLines.map((l) => `${l.skuName} (${l.daysOfCover === null ? "no recent sales" : `${l.daysOfCover} days of cover`})`).join(", ") +
        "."
    );
  }
  if (remainingRedemptions > 0) {
    briefing.push(
      `The queued campaign can still draw ${remainingRedemptions} bundle${remainingRedemptions === 1 ? "" : "s"} - projected stock after the campaign is already reflected below.`
    );
  }
  if (restockTotalUnits > 0) {
    briefing.push(
      `Suggested restock plan: ${restockTotalUnits} units across ${lines.filter((l) => l.restockUnits > 0).length} SKUs, estimated ${formatINR(restockTotalCostPaise)} at current unit costs. Advisory only - nothing is ordered automatically.`
    );
  }

  // ---- serve pillar: consent health + redemption champions
  const consentRows = db
    .prepare(
      `SELECT c.status AS status, COUNT(*) AS n FROM consents c
       JOIN customers cu ON cu.id = c.customer_id
       WHERE cu.merchant_id = ? GROUP BY c.status`
    )
    .all(merchantId) as { status: string; n: number }[];
  const consentByStatus = Object.fromEntries(consentRows.map((r) => [r.status, r.n]));
  const consents = {
    active: consentByStatus["active"] ?? 0,
    revoked: consentByStatus["revoked"] ?? 0,
    none: consentByStatus["none"] ?? 0,
    channel: fixture.customers.channel,
  };

  const champions: ServeBlock["champions"] = [];
  if (camp && camp.status === "queued") {
    const perEvent = db
      .prepare(
        "SELECT event_id, SUM(quantity) AS q, SUM(amount_paise) AS amt FROM redemptions WHERE campaign_id = ? GROUP BY event_id ORDER BY q DESC LIMIT 5"
      )
      .all(camp.id) as { event_id: string; q: number; amt: number }[];
    for (const row of perEvent) {
      const event = fixture.simulatedRedemptionEvents.find((e) => e.eventId === row.event_id);
      if (!event) continue;
      const localId = event.customerId;
      const customer = db
        .prepare("SELECT display_label, demo_channel_id FROM customers WHERE merchant_id = ? AND id LIKE '%' || ?")
        .get(merchantId, localId) as { display_label: string; demo_channel_id: string } | undefined;
      champions.push({
        label: customer?.display_label ?? localId,
        demoChannelId: customer?.demo_channel_id ?? "-",
        units: row.q,
        spendPaise: row.amt,
      });
    }
  }

  return {
    merchantId,
    merchantName: merchant?.display_name ?? "this business",
    windowLabel: currWin.label,
    targetCoverDays: TARGET_COVER_DAYS,
    lines,
    restockTotalUnits,
    restockTotalCostPaise,
    briefing,
    serve: { consents, champions },
  };
}
