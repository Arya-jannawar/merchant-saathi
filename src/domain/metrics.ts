import type { SqliteDatabase } from "@/lib/db";
import { lastCompleteAfternoonWindow, previousAfternoonWindow, type AfternoonWindow } from "@/lib/clock";
import { formatINR, formatPct } from "@/lib/money";
import type { Fixture } from "@/lib/fixture";

/**
 * Deterministic sales metrics. Every number shown in the UI is computed here
 * from order rows - never hand-drawn. An observed delta is NOT a cause.
 */

export interface WindowTotals {
  orders: number;
  netSalesPaise: number;
}

export function completedTotalsInRange(
  db: SqliteDatabase,
  merchantId: string,
  startIso: string,
  endIsoExclusive: string
): WindowTotals {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total_paise),0) AS net FROM orders WHERE merchant_id = ? AND status = 'completed' AND occurred_at >= ? AND occurred_at < ?"
    )
    .get(merchantId, startIso, endIsoExclusive) as { n: number; net: number };
  return { orders: row.n, netSalesPaise: row.net };
}

/**
 * The five daily 15:00-18:00 IST bands of a Mon-Fri window. The afternoon
 * "window" is the UNION of these bands - not the continuous Mon-to-Fri range
 * (which would wrongly include Tue-Fri mornings).
 */
export function afternoonBands(windowStartIso: string): { startIso: string; endIso: string }[] {
  const DAY_MS = 86_400_000;
  const BAND_MS = 3 * 3_600_000;
  const start = new Date(windowStartIso).getTime();
  return Array.from({ length: 5 }, (_, i) => ({
    startIso: new Date(start + i * DAY_MS).toISOString(),
    endIso: new Date(start + i * DAY_MS + BAND_MS).toISOString(),
  }));
}

/** Completed orders inside a window's five daily 3-6 p.m. IST bands. */
export function completedAfternoonTotals(
  db: SqliteDatabase,
  merchantId: string,
  window: { startIso: string }
): WindowTotals {
  const bands = afternoonBands(window.startIso);
  const clauses = bands.map(() => "(occurred_at >= ? AND occurred_at < ?)").join(" OR ");
  const params: string[] = [merchantId];
  for (const b of bands) params.push(b.startIso, b.endIso);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_paise),0) AS net FROM orders WHERE merchant_id = ? AND status = 'completed' AND (${clauses})`
    )
    .get(...params) as { n: number; net: number };
  return { orders: row.n, netSalesPaise: row.net };
}

/** Percentage change; null when the baseline is zero (undefined, not 100%). */
export function salesDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export function averageOrderValuePaise(t: WindowTotals): number | null {
  if (t.orders === 0) return null;
  return Math.round(t.netSalesPaise / t.orders);
}

export interface EvidenceEntry {
  id: string;
  label: string;
  definition: string;
  valueLabel: string;
  period: string;
  source: string;
}

export interface OpportunityItem {
  id: string;
  observation: string;
  metricIds: string[];
  limitations: string[];
  windows: {
    previous: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    current: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
  };
  suggestedOffer: { pricePaise: number; cap: number; bundleName: string; normalPricePaise: number };
  evidence: EvidenceEntry[];
}

export interface OpportunitiesResult {
  dataMode: "synthetic-fixture";
  fixtureVersion: string;
  nowIso: string;
  windowLabels: { previous: string; current: string };
  items: OpportunityItem[];
  lowDataReason: string | null;
  eligibility: {
    previousOrders: number;
    currentOrders: number;
    minOrdersRequired: number;
    declinePct: number | null;
    declineThresholdPct: number;
  };
}

export function getOpportunities(
  db: SqliteDatabase,
  merchantId: string,
  fixture: Fixture,
  now: Date
): OpportunitiesResult {
  const currWin: AfternoonWindow = lastCompleteAfternoonWindow(now);
  const prevWin: AfternoonWindow = previousAfternoonWindow(currWin);

  const prevTotals = completedAfternoonTotals(db, merchantId, prevWin);
  const currTotals = completedAfternoonTotals(db, merchantId, currWin);

  const declinePct = salesDeltaPct(currTotals.orders, prevTotals.orders);
  const minOrders = fixture.policy.minCompletedOrdersPerWindow;
  const threshold = fixture.policy.declineThresholdPct;

  const eligibility = {
    previousOrders: prevTotals.orders,
    currentOrders: currTotals.orders,
    minOrdersRequired: minOrders,
    declinePct,
    declineThresholdPct: threshold,
  };

  const windowLabels = { previous: prevWin.label, current: currWin.label };
  const base = {
    dataMode: "synthetic-fixture" as const,
    fixtureVersion: fixture.fixtureVersion,
    nowIso: now.toISOString(),
    windowLabels,
    eligibility,
  };

  if (prevTotals.orders < minOrders || currTotals.orders < minOrders) {
    return {
      ...base,
      items: [],
      lowDataReason: `Both compared windows need at least ${minOrders} completed afternoon orders each (found ${prevTotals.orders} and ${currTotals.orders}). Load the sample data or wait for a fuller window.`,
    };
  }

  if (declinePct === null || declinePct > -threshold) {
    return {
      ...base,
      items: [],
      lowDataReason: `No qualifying afternoon decline in the last two complete Mon-Fri windows (${declinePct === null ? "baseline unavailable" : `${formatPct(declinePct / 100)} vs a -${threshold}% threshold`}).`,
    };
  }

  // Actionable inventory: the bundle must be physically possible this week.
  const capacity = computeBundleCapacity(fixture);

  // Variable cost of one bundle, from the fixture inventory (component quantities x unit cost).
  const bundleCostPaise = fixture.bundle.components.reduce((sum, c) => {
    const inv = fixture.inventory.find((i) => i.skuId === c.skuId);
    return sum + (inv ? inv.unitVariableCostPaise * c.quantity : 0);
  }, 0);

  const evidence: EvidenceEntry[] = [
    {
      id: "afternoon-order-delta-v1",
      label: "Completed 3-6 p.m. orders",
      definition:
        "Count of orders with status 'completed' that occurred 15:00-17:59 IST on Mon-Fri, per five-day window. Pending and canceled orders are excluded.",
      valueLabel: `${prevTotals.orders} \u2192 ${currTotals.orders} (${formatPct((declinePct ?? 0) / 100)})`,
      period: `${prevWin.label} vs ${currWin.label}`,
      source: "orders table (synthetic demo POS rows)",
    },
    {
      id: "afternoon-net-sales-v1",
      label: "Net afternoon sales",
      definition:
        "Sum of completed order totals for the same windows. Item selling prices less item discounts; excludes separately charged tax/fees; not gateway settlement proceeds.",
      valueLabel: `${formatINR(prevTotals.netSalesPaise)} \u2192 ${formatINR(currTotals.netSalesPaise)} (${formatPct(
        (salesDeltaPct(currTotals.netSalesPaise, prevTotals.netSalesPaise) ?? 0) / 100
      )})`,
      period: `${prevWin.label} vs ${currWin.label}`,
      source: "orders table (synthetic demo POS rows)",
    },
    {
      id: "afternoon-aov-v1",
      label: "Average order value",
      definition: "Net completed sales divided by completed order count, per window.",
      valueLabel: `${formatINR(averageOrderValuePaise(prevTotals) ?? 0)} \u2192 ${formatINR(averageOrderValuePaise(currTotals) ?? 0)}`,
      period: `${prevWin.label} vs ${currWin.label}`,
      source: "derived from orders table",
    },
    {
      id: "bundle-margin-v1",
      label: "Bundle contribution margin",
      definition: "(Proposed price - variable cost per bundle) / proposed price, compared with the merchant's margin floor.",
      valueLabel: `${formatINR(fixture.bundle.proposedPricePaise)} - ${formatINR(bundleCostPaise)} = ${formatINR(
        fixture.bundle.proposedPricePaise - bundleCostPaise
      )} (${formatPct(
        (fixture.bundle.proposedPricePaise - bundleCostPaise) / fixture.bundle.proposedPricePaise
      )}) vs ${fixture.policy.minMarginPct}% floor`,
      period: `proposed for ${currWin.label} successor weekday`,
      source: "fixture bundle + inventory unit costs",
    },
    {
      id: "bundle-capacity-v1",
      label: "Stock capacity & exposure cap",
      definition:
        "Physical capacity = min over bundle components of floor(stock / required quantity). Discount exposure = discount per bundle x redemption cap.",
      valueLabel: `${capacity} bundles max from stock; cap ${fixture.bundle.cap}/day; max exposure ${formatINR(
        (fixture.bundle.normalPricePaise - fixture.bundle.proposedPricePaise) * fixture.bundle.cap
      )}`,
      period: "current stock counts",
      source: "inventory table (demo stock counts)",
    },
    {
      id: "audience-consent-v1",
      label: "Eligible audience (consented)",
      definition: `Customers with an active ${fixture.customers.channel} consent. Revoked/never-captured consents are excluded.`,
      valueLabel: `${fixture.customers.activeSms} eligible, ${
        fixture.customers.total - fixture.customers.activeSms
      } excluded`,
      period: "current consent register",
      source: "consents table (synthetic demo CRM)",
    },
  ];

  const item: OpportunityItem = {
    id: "afternoon-decline-v1",
    observation: `Completed 3-6 p.m. orders fell from ${prevTotals.orders} to ${currTotals.orders} between ${prevWin.label} and ${currWin.label} (${formatPct(
      (declinePct ?? 0) / 100
    )}), while average order value held at ${formatINR(averageOrderValuePaise(currTotals) ?? 0)}. Stock on hand can support a capped afternoon bundle.`,
    metricIds: evidence.map((e) => e.id),
    limitations: [
      "Two five-day windows - a small sample. This supports a testable suggestion, not proof of cause.",
      "No evidence identifies why orders declined (weather, competition, holidays are NOT established).",
      "Variable costs cover ingredients and packaging only - not rent, labour, tax or spoilage.",
    ],
    windows: {
      previous: {
        label: prevWin.label,
        orders: prevTotals.orders,
        netSalesPaise: prevTotals.netSalesPaise,
        aovPaise: averageOrderValuePaise(prevTotals),
      },
      current: {
        label: currWin.label,
        orders: currTotals.orders,
        netSalesPaise: currTotals.netSalesPaise,
        aovPaise: averageOrderValuePaise(currTotals),
      },
    },
    suggestedOffer: {
      pricePaise: fixture.bundle.proposedPricePaise,
      cap: fixture.bundle.cap,
      bundleName: fixture.bundle.name,
      normalPricePaise: fixture.bundle.normalPricePaise,
    },
    evidence,
  };

  return { ...base, items: [item], lowDataReason: null };
}

export function computeBundleCapacity(fixture: Fixture): number {
  let capacity = Number.POSITIVE_INFINITY;
  for (const c of fixture.bundle.components) {
    const inv = fixture.inventory.find((i) => i.skuId === c.skuId);
    if (!inv) return 0;
    capacity = Math.min(capacity, Math.floor(inv.quantity / c.quantity));
  }
  return Number.isFinite(capacity) ? capacity : 0;
}
