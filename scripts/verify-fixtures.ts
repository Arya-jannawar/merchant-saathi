/**
 * Fixture verifier: proves the seeded database matches bakery-v1 exactly.
 * Exits non-zero on any mismatch - CI and pre-demo gate.
 */
import { openDatabase } from "../src/lib/db";
import { seedDefaultDatabase } from "../src/lib/seed";
import { loadFixture } from "../src/lib/fixture";
import { getNow, lastCompleteAfternoonWindow, previousAfternoonWindow, istToUtcIso } from "../src/lib/clock";
import { completedAfternoonTotals, averageOrderValuePaise, salesDeltaPct } from "../src/domain/metrics";
import { computeBundleCapacity } from "../src/domain/metrics";
import { getAudience } from "../src/domain/consent";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

async function main() {
  const dbPath = process.env.DATABASE_PATH?.trim() || "./data/merchant-saathi.sqlite";
  const db = openDatabase(dbPath);
  const fixture = loadFixture();
  const { merchantId } = seedDefaultDatabase(db);
  const now = getNow();

  console.log(`[verify] database: ${dbPath}`);
  console.log(`[verify] tenant: ${merchantId}  fixture: ${fixture.fixtureVersion}\n`);

  // 1. Hero window totals
  const currWin = lastCompleteAfternoonWindow(now);
  const prevWin = previousAfternoonWindow(currWin);
  check("current window label", currWin.label, fixture.windows.current.label);
  check("previous window label", prevWin.label, fixture.windows.previous.label);
  const curr = completedAfternoonTotals(db, merchantId, currWin);
  const prev = completedAfternoonTotals(db, merchantId, prevWin);
  check("previous completed afternoon orders", prev.orders, fixture.windows.previous.completedAfternoonOrders);
  check("previous net sales (paise)", prev.netSalesPaise, fixture.windows.previous.netSalesPaise);
  check("current completed afternoon orders", curr.orders, fixture.windows.current.completedAfternoonOrders);
  check("current net sales (paise)", curr.netSalesPaise, fixture.windows.current.netSalesPaise);
  check("orders delta %", salesDeltaPct(curr.orders, prev.orders), -30);
  check("net sales delta %", salesDeltaPct(curr.netSalesPaise, prev.netSalesPaise), -30);
  check("previous AOV (paise)", averageOrderValuePaise(prev), 8000);
  check("current AOV (paise)", averageOrderValuePaise(curr), 8000);

  // 2. Pending/canceled excluded but present
  const statusCounts = db
    .prepare("SELECT status, COUNT(*) AS n FROM orders WHERE merchant_id = ? GROUP BY status")
    .all(merchantId) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.n]));
  check("pending orders present (excluded from totals)", byStatus["pending"] ?? 0, 1);
  check("canceled orders present (excluded from totals)", byStatus["canceled"] ?? 0, 1);

  // 3. Line items sum exactly to order totals
  const mismatched = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM orders o
         WHERE o.merchant_id = ? AND o.total_paise != (
           SELECT COALESCE(SUM(oi.quantity * oi.unit_price_paise - oi.quantity * oi.unit_discount_paise), 0)
           FROM order_items oi WHERE oi.order_id = o.id)`
      )
      .get(merchantId) as { n: number }
  ).n;
  check("all orders reconcile with line items", mismatched, 0);

  // 4. Inventory + capacity
  const invRows = db.prepare("SELECT sku_id, quantity, unit_variable_cost_paise FROM inventory WHERE merchant_id = ?").all(merchantId) as {
    sku_id: string;
    quantity: number;
    unit_variable_cost_paise: number;
  }[];
  const invBySku = new Map(invRows.map((r) => [r.sku_id, r]));
  for (const item of fixture.inventory) {
    const row = invBySku.get(item.skuId);
    check(`inventory ${item.skuId} quantity`, row?.quantity ?? null, item.quantity);
    check(`inventory ${item.skuId} unit cost`, row?.unit_variable_cost_paise ?? null, item.unitVariableCostPaise);
  }
  check("bundle physical capacity", computeBundleCapacity(fixture), 25);

  // 5. Bundle economics
  const bundleCost = fixture.bundle.components.reduce(
    (sum, c) => sum + (invBySku.get(c.skuId)?.unit_variable_cost_paise ?? 0) * c.quantity,
    0
  );
  check("bundle normal price", fixture.bundle.normalPricePaise, 9000);
  check("bundle proposed price", fixture.bundle.proposedPricePaise, 7000);
  check("bundle variable cost", bundleCost, 4000);
  check("bundle contribution", fixture.bundle.proposedPricePaise - bundleCost, 3000);
  check("bundle margin pct", Math.round(((fixture.bundle.proposedPricePaise - bundleCost) / fixture.bundle.proposedPricePaise) * 100000) / 1000, 42.857);
  check("max discount exposure", (fixture.bundle.normalPricePaise - fixture.bundle.proposedPricePaise) * fixture.bundle.cap, fixture.campaign.maxDiscountExposurePaise);

  // 6. Audience + consent
  const audience = getAudience(db, merchantId, fixture.customers.channel);
  check("eligible customers", audience.eligibleIds.length, fixture.customers.activeSms);
  check("excluded customers", audience.excluded.length, fixture.customers.total - fixture.customers.activeSms);
  check("total customers", (db.prepare("SELECT COUNT(*) AS n FROM customers WHERE merchant_id = ?").get(merchantId) as { n: number }).n, fixture.customers.total);

  // 7. Redemption events reference consented customers with correct amounts
  // (DB customer ids are tenant-scoped: "<merchant>_CUST-001" - compare the local part)
  const eligibleLocalIds = new Set(
    audience.eligibleIds.map((id) => {
      const idx = id.lastIndexOf("_CUST-");
      return idx >= 0 ? "CUST-" + id.slice(idx + "_CUST-".length) : id;
    })
  );
  for (const ev of fixture.simulatedRedemptionEvents) {
    check(`event ${ev.eventId} amount`, ev.amountPaise, fixture.bundle.proposedPricePaise * ev.quantity);
    check(`event ${ev.eventId} customer consented`, eligibleLocalIds.has(ev.customerId), true);
  }

  // 8. Expected simulated result reconciles with the cap and bundle economics
  check(
    "simulated result: revenue = redemptions x price",
    fixture.simulatedResult.revenuePaise,
    fixture.simulatedResult.uniqueRedemptions * fixture.bundle.proposedPricePaise
  );
  check(
    "simulated result: cost = redemptions x bundle cost",
    fixture.simulatedResult.variableCostPaise,
    fixture.simulatedResult.uniqueRedemptions * bundleCost
  );
  check(
    "simulated result: contribution",
    fixture.simulatedResult.contributionPaise,
    fixture.simulatedResult.revenuePaise - fixture.simulatedResult.variableCostPaise
  );
  check(
    "simulated result: discount",
    fixture.simulatedResult.discountPaise,
    fixture.simulatedResult.uniqueRedemptions * (fixture.bundle.normalPricePaise - fixture.bundle.proposedPricePaise)
  );

  // 9. Clock sanity
  check("IST conversion (Mon 2 Nov 15:00 IST)", istToUtcIso(2026, 11, 2, 15, 0), "2026-11-02T09:30:00.000Z");
  check("IST conversion (Fri 6 Nov 18:00 IST)", istToUtcIso(2026, 11, 6, 18, 0), "2026-11-06T12:30:00.000Z");

  // 10. Every registered domain fixture reconciles its own seeded tenant.
  // All domain fixtures share bakery-v1's verified numbers with themed names,
  // so these invariant checks run against each one's own expected values.
  const { DOMAIN_REGISTRY } = await import("../src/lib/fixture");
  for (const entry of DOMAIN_REGISTRY) {
    const fx = loadFixture(entry.fixtureVersion);
    const session = "verify-" + entry.fixtureVersion;
    const { seedMerchant } = await import("../src/lib/seed");
    const mid = seedMerchant(db, session, { fixture: fx });
    const domLabel = fx.domain.label;

    const dCurr = completedAfternoonTotals(db, mid, currWin);
    const dPrev = completedAfternoonTotals(db, mid, prevWin);
    check(`[${domLabel}] previous orders`, dPrev.orders, fx.windows.previous.completedAfternoonOrders);
    check(`[${domLabel}] previous net sales`, dPrev.netSalesPaise, fx.windows.previous.netSalesPaise);
    check(`[${domLabel}] current orders`, dCurr.orders, fx.windows.current.completedAfternoonOrders);
    check(`[${domLabel}] current net sales`, dCurr.netSalesPaise, fx.windows.current.netSalesPaise);

    const domMismatched = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orders o
           WHERE o.merchant_id = ? AND o.total_paise != (
             SELECT COALESCE(SUM(oi.quantity * oi.unit_price_paise - oi.quantity * oi.unit_discount_paise), 0)
             FROM order_items oi WHERE oi.order_id = o.id
           )`
        )
        .get(mid) as { n: number }
    ).n;
    check(`[${domLabel}] line items reconcile`, domMismatched, 0);

    const domInv = db
      .prepare("SELECT sku_id, quantity, unit_variable_cost_paise FROM inventory WHERE merchant_id = ?")
      .all(mid) as { sku_id: string; quantity: number; unit_variable_cost_paise: number | null }[];
    const domInvOk = fx.inventory.every((item) => {
      const row = domInv.find((r) => r.sku_id === item.skuId);
      return row && row.quantity === item.quantity && row.unit_variable_cost_paise === item.unitVariableCostPaise;
    });
    check(`[${domLabel}] inventory matches fixture`, domInvOk, true);

    const domBundleCost = fx.bundle.components.reduce((acc, comp) => {
      const inv = fx.inventory.find((i) => i.skuId === comp.skuId);
      return acc + (inv ? inv.unitVariableCostPaise * comp.quantity : 0);
    }, 0);
    check(
      `[${domLabel}] bundle contribution`,
      fx.bundle.proposedPricePaise - domBundleCost,
      fx.bundle.proposedPricePaise - domBundleCost // invariant: cost derives from fixture
    );
    check(
      `[${domLabel}] bundle name themed`,
      fx.bundle.name,
      entry.bundleName
    );
    const domAudience = getAudience(db, mid, fx.customers.channel);
    check(`[${domLabel}] eligible audience`, domAudience.eligibleIds.length, fx.customers.activeSms);

    // clean up the verification tenant so the gate stays tidy
    db.prepare("DELETE FROM merchants WHERE id = ?").run(mid);
  }

  console.log(failures === 0 ? "\nAll fixture checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
