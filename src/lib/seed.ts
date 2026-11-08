import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./db";
import { withTransaction } from "./db";
import { loadFixture, type Fixture } from "./fixture";
import { getNow, istToUtcIso, lastCompleteAfternoonWindow, previousAfternoonWindow, istParts } from "./clock";
import { completedAfternoonTotals } from "../domain/metrics";

/**
 * Deterministic seeder. Given the same fixture it always produces the same
 * database content (seeded PRNG, fixed distributions), so demo numbers
 * reconcile every single time.
 */

// mulberry32 - tiny deterministic PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlannedOrder {
  externalId: string;
  occurredAtIso: string;
  status: "completed" | "pending" | "canceled";
  totalPaise: number;
}

/** Compose an order total from menu items exactly (all prices are multiples of 500 paise). */
function composeOrderTargets(
  totalPaise: number,
  skuPrices: { skuId: string; pricePaise: number }[],
  rand: () => number
): { skuId: string; quantity: number }[] {
  const scale = 500;
  const scaled = skuPrices.map((s) => ({ skuId: s.skuId, p: s.pricePaise / scale }));
  const target = totalPaise / scale;
  if (!Number.isInteger(target)) throw new Error(`Order total ${totalPaise} is not a multiple of ${scale}`);

  const canMemo = new Map<number, boolean>();
  const can = (t: number): boolean => {
    if (t === 0) return true;
    const cached = canMemo.get(t);
    if (cached !== undefined) return cached;
    let ok = false;
    for (const { p } of scaled) {
      if (p <= t && can(t - p)) {
        ok = true;
        break;
      }
    }
    canMemo.set(t, ok);
    return ok;
  };
  if (!can(target)) throw new Error(`Unreachable order total: ${totalPaise} paise`);

  const picks: { skuId: string; quantity: number }[] = [];
  let t = target;
  while (t > 0) {
    const options = scaled.filter((s) => s.p <= t && can(t - s.p));
    const pick = options[Math.floor(rand() * options.length)];
    const existing = picks.find((x) => x.skuId === pick.skuId);
    if (existing) existing.quantity += 1;
    else picks.push({ skuId: pick.skuId, quantity: 1 });
    t -= pick.p;
  }
  return picks;
}

/** Exact per-order totals for the two hero windows (sum must match fixture). */
function heroWindowTotals(window: "previous" | "current"): number[] {
  if (window === "previous") {
    // 100 orders, exactly Rs 8,000: 30x60 + 30x80 + 20x90 + 20x100
    const list: number[] = [];
    for (let i = 0; i < 30; i++) list.push(6000);
    for (let i = 0; i < 30; i++) list.push(8000);
    for (let i = 0; i < 20; i++) list.push(9000);
    for (let i = 0; i < 20; i++) list.push(10000);
    return list;
  }
  // 70 orders, exactly Rs 5,600: 10x60 + 15x70 + 20x80 + 15x90 + 10x100
  const list: number[] = [];
  for (let i = 0; i < 10; i++) list.push(6000);
  for (let i = 0; i < 15; i++) list.push(7000);
  for (let i = 0; i < 20; i++) list.push(8000);
  for (let i = 0; i < 15; i++) list.push(9000);
  for (let i = 0; i < 10; i++) list.push(10000);
  return list;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random IST instant inside the 15:02-17:40 afternoon band of a given date. */
function afternoonInstant(mondayIsoDate: string, dayOffset: number, rand: () => number): string {
  const [y, m, d] = mondayIsoDate.split("-").map(Number);
  const minuteOfDay = 15 * 60 + 2 + Math.floor(rand() * 158); // 15:02 .. 17:39
  return istToUtcIso(y, m, d + dayOffset, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}

function morningInstant(mondayIsoDate: string, dayOffset: number, rand: () => number): string {
  const [y, m, d] = mondayIsoDate.split("-").map(Number);
  const minuteOfDay = 8 * 60 + 5 + Math.floor(rand() * 170); // 08:05 .. 10:54
  return istToUtcIso(y, m, d + dayOffset, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}

/** Plan every order row (deterministically) before inserting. */
function planOrders(fixture: Fixture, rand: () => number): PlannedOrder[] {
  const orders: PlannedOrder[] = [];
  let seq = 100001;

  const pushDaySpread = (mondayIsoDate: string, totals: number[], status: PlannedOrder["status"] = "completed") => {
    const shuffled = shuffle(totals, rand);
    shuffled.forEach((totalPaise, i) => {
      orders.push({
        externalId: `ORD-${seq++}`,
        occurredAtIso: afternoonInstant(mondayIsoDate, i % 5, rand),
        status,
        totalPaise,
      });
    });
  };

  // Context weeks (Mon-Fri afternoons): plausible, no exact invariant.
  for (const monday of ["2026-10-12", "2026-10-19"]) {
    const totals: number[] = [];
    for (let day = 0; day < 5; day++) {
      const count = 17 + Math.floor(rand() * 6); // 17-22 orders/day
      for (let i = 0; i < count; i++) {
        totals.push((5 + Math.floor(rand() * 7)) * 1000); // Rs 50..110
      }
    }
    pushDaySpread(monday, totals);
  }

  // Hero windows - exact fixture totals.
  pushDaySpread(fixture.windows.previous.mondayIsoDate, heroWindowTotals("previous"));
  pushDaySpread(fixture.windows.current.mondayIsoDate, heroWindowTotals("current"));

  // Morning trade for both hero weeks (context: shows the decline is afternoon-specific).
  for (const monday of [fixture.windows.previous.mondayIsoDate, fixture.windows.current.mondayIsoDate]) {
    for (let day = 0; day < 5; day++) {
      const count = 22 + Math.floor(rand() * 7); // 22-28 orders
      for (let i = 0; i < count; i++) {
        const totalPaise = [4000, 5000, 5000, 6000, 8000][Math.floor(rand() * 5)];
        orders.push({
          externalId: `ORD-${seq++}`,
          occurredAtIso: morningInstant(monday, day, rand),
          status: "completed",
          totalPaise,
        });
      }
    }
  }

  // One pending + one canceled order inside the current afternoon window
  // (both must be excluded from completed metrics).
  const [cy, cm, cd] = fixture.windows.current.mondayIsoDate.split("-").map(Number);
  orders.push({
    externalId: `ORD-${seq++}`,
    occurredAtIso: istToUtcIso(cy, cm, cd + 4, 17, 30), // Fri 17:30 IST
    status: "pending",
    totalPaise: 7000,
  });
  orders.push({
    externalId: `ORD-${seq++}`,
    occurredAtIso: istToUtcIso(cy, cm, cd + 2, 16, 10), // Wed 16:10 IST
    status: "canceled",
    totalPaise: 5000,
  });

  return orders;
}

export function seedTenant(db: SqliteDatabase, demoSessionId: string, fixture: Fixture = loadFixture()): string {
  const now = getNow();
  const merchantId = `mrc_${demoSessionId.replace(/-/g, "").slice(0, 20)}`;
  const createdAt = now.toISOString();
  const rand = mulberry32(20261106);

  const existing = db.prepare("SELECT id FROM merchants WHERE demo_session_id = ?").get(demoSessionId) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  withTransaction(db, () => {
    db.prepare(
      "INSERT INTO merchants (id, demo_session_id, display_name, timezone, currency, fixture_version, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(
      merchantId,
      demoSessionId,
      fixture.merchant.displayName,
      fixture.merchant.timezone,
      fixture.merchant.currency,
      fixture.fixtureVersion,
      createdAt
    );

    // Inventory
    const invStmt = db.prepare(
      "INSERT INTO inventory (merchant_id, sku_id, quantity, unit_variable_cost_paise, version, updated_at) VALUES (?,?,?,?,1,?)"
    );
    for (const item of fixture.inventory) {
      invStmt.run(merchantId, item.skuId, item.quantity, item.unitVariableCostPaise, createdAt);
    }

    // Customers + consent
    const custStmt = db.prepare(
      "INSERT INTO customers (id, merchant_id, demo_channel_id, display_label) VALUES (?,?,?,?)"
    );
    const consentStmt = db.prepare(
      "INSERT INTO consents (id, customer_id, channel, status, captured_at, source, revoked_at) VALUES (?,?,?,?,?,?,?)"
    );
    const { total, activeSms, revokedSms, channel, consentSources } = fixture.customers;
    for (let i = 1; i <= total; i++) {
      // Customer ids are scoped by tenant so multiple demo sessions can coexist.
      const custId = `${merchantId}_CUST-${String(i).padStart(3, "0")}`;
      custStmt.run(custId, merchantId, `demo-block-${String(4000 + i)}`, `Customer ${String(i).padStart(3, "0")}`);
      const capturedAt = istToUtcIso(2026, 10, 1 + (i % 5), 10 + (i % 8), (i * 7) % 60);
      if (i <= activeSms) {
        consentStmt.run(
          `con_${custId}_${channel}`,
          custId,
          channel,
          "active",
          capturedAt,
          consentSources[i % consentSources.length],
          null
        );
      } else if (i <= activeSms + revokedSms) {
        consentStmt.run(
          `con_${custId}_${channel}`,
          custId,
          channel,
          "revoked",
          capturedAt,
          consentSources[i % consentSources.length],
          istToUtcIso(2026, 10, 20 + (i % 5), 12, 0)
        );
      } else {
        consentStmt.run(`con_${custId}_${channel}`, custId, channel, "none", capturedAt, "never captured", null);
      }
    }

    // Orders + items
    const orderStmt = db.prepare(
      "INSERT INTO orders (id, merchant_id, external_id, occurred_at, status, total_paise) VALUES (?,?,?,?,?,?)"
    );
    const itemStmt = db.prepare(
      "INSERT INTO order_items (order_id, sku_id, quantity, unit_price_paise, unit_discount_paise) VALUES (?,?,?,?,0)"
    );
    const planned = planOrders(fixture, rand);
    const skuPrices = fixture.skus.map((s) => ({ skuId: s.id, pricePaise: s.pricePaise }));
    for (const o of planned) {
      const orderId = `${merchantId}_${o.externalId}`;
      orderStmt.run(orderId, merchantId, o.externalId, o.occurredAtIso, o.status, o.totalPaise);
      const items = composeOrderTargets(o.totalPaise, skuPrices, rand);
      let sumCheck = 0;
      for (const item of items) {
        const sku = fixture.skus.find((s) => s.id === item.skuId);
        if (!sku) throw new Error(`Unknown SKU ${item.skuId}`);
        sumCheck += sku.pricePaise * item.quantity;
        itemStmt.run(orderId, item.skuId, item.quantity, sku.pricePaise);
      }
      if (sumCheck !== o.totalPaise) {
        throw new Error(`Line items sum ${sumCheck} != order total ${o.totalPaise} for ${o.externalId}`);
      }
    }

    // Evidence snapshots computed from the rows we just inserted (never hardcoded).
    const prevWin = previousAfternoonWindow(lastCompleteAfternoonWindow(now));
    const currWin = lastCompleteAfternoonWindow(now);
    const prev = completedAfternoonTotals(db, merchantId, prevWin);
    const curr = completedAfternoonTotals(db, merchantId, currWin);

    const snapStmt = db.prepare(
      "INSERT INTO metric_snapshots (id, merchant_id, fixture_version, period_start, period_end, definition_version, values_json, computed_at) VALUES (?,?,?,?,?,?,?,?)"
    );
    const defVersion = fixture.definitionVersion;
    const computedAt = createdAt;
    const snap = (
      id: string,
      periodStart: string,
      periodEnd: string,
      values: Record<string, unknown>
    ) =>
      snapStmt.run(
        `${merchantId}_${id}`, // scoped per tenant; the evidence id stays the public label
        merchantId,
        fixture.fixtureVersion,
        periodStart,
        periodEnd,
        defVersion,
        JSON.stringify(values),
        computedAt
      );

    const pct = (c: number, p: number) => (p === 0 ? null : Math.round(((c - p) / p) * 10000) / 100);

    snap("afternoon-order-delta-v1", prevWin.startIso, currWin.endIso, {
      previousOrders: prev.orders,
      currentOrders: curr.orders,
      deltaPct: pct(curr.orders, prev.orders),
      previousLabel: prevWin.label,
      currentLabel: currWin.label,
    });
    snap("afternoon-net-sales-v1", prevWin.startIso, currWin.endIso, {
      previousNetSalesPaise: prev.netSalesPaise,
      currentNetSalesPaise: curr.netSalesPaise,
      deltaPct: pct(curr.netSalesPaise, prev.netSalesPaise),
    });
    snap("afternoon-aov-v1", prevWin.startIso, currWin.endIso, {
      previousAovPaise: prev.orders ? Math.round(prev.netSalesPaise / prev.orders) : null,
      currentAovPaise: curr.orders ? Math.round(curr.netSalesPaise / curr.orders) : null,
    });

    // Bundle economics + capacity + audience are computed from fixture/inventory/consent rows.
    const invRows = db.prepare("SELECT sku_id, quantity, unit_variable_cost_paise FROM inventory WHERE merchant_id=?").all(
      merchantId
    ) as { sku_id: string; quantity: number; unit_variable_cost_paise: number | null }[];
    const invBySku = new Map(invRows.map((r) => [r.sku_id, r]));
    let capacity = Number.POSITIVE_INFINITY;
    let bundleCostAccumulator = 0;
    let bundleCostKnown = true;
    for (const c of fixture.bundle.components) {
      const row = invBySku.get(c.skuId);
      if (!row || row.unit_variable_cost_paise === null) bundleCostKnown = false;
      else bundleCostAccumulator += row.unit_variable_cost_paise * c.quantity;
      if (row) capacity = Math.min(capacity, Math.floor(row.quantity / c.quantity));
    }
    if (!Number.isFinite(capacity)) capacity = 0;
    const bundleCost: number | null = bundleCostKnown ? bundleCostAccumulator : null;

    snap("bundle-margin-v1", prevWin.startIso, currWin.endIso, {
      pricePaise: fixture.bundle.proposedPricePaise,
      normalPricePaise: fixture.bundle.normalPricePaise,
      bundleCostPaise: bundleCost,
      contributionPaise: bundleCost === null ? null : fixture.bundle.proposedPricePaise - bundleCost,
      floorPct: fixture.policy.minMarginPct,
    });
    snap("bundle-capacity-v1", prevWin.startIso, currWin.endIso, {
      capacity,
      redemptionCap: fixture.bundle.cap,
      maxDiscountExposurePaise:
        (fixture.bundle.normalPricePaise - fixture.bundle.proposedPricePaise) * fixture.bundle.cap,
    });
    const eligibleCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM consents c JOIN customers cu ON cu.id=c.customer_id WHERE cu.merchant_id=? AND c.channel=? AND c.status='active'"
        )
        .get(merchantId, fixture.customers.channel) as { n: number }
    ).n;
    snap("audience-consent-v1", prevWin.startIso, currWin.endIso, {
      eligible: eligibleCount,
      excluded: fixture.customers.total - eligibleCount,
      channel: fixture.customers.channel,
    });
  });

  return merchantId;
}

export function resetTenant(db: SqliteDatabase, demoSessionId: string): string {
  const existing = db.prepare("SELECT id FROM merchants WHERE demo_session_id = ?").get(demoSessionId) as
    | { id: string }
    | undefined;
  withTransaction(db, () => {
    if (existing) {
      db.prepare(
        "DELETE FROM idempotency_requests WHERE key IN (SELECT 'exec:' || id || ':' || version FROM campaigns WHERE merchant_id = ?)"
      ).run(existing.id);
      db.prepare("DELETE FROM audit_events WHERE merchant_id = ?").run(existing.id);
      db.prepare("DELETE FROM merchants WHERE id = ?").run(existing.id); // cascades to all child rows
    }
  });
  return seedTenant(db, demoSessionId);
}

/** For CLI seeding of the default local database. */
export function seedDefaultDatabase(db: SqliteDatabase): { merchantId: string; session: string } {
  const session = "local-dev-session";
  const merchantId = seedTenant(db, session);
  return { merchantId, session };
}

export { istParts };
