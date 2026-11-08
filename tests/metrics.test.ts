import { describe, expect, it, beforeAll } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import { getNow, lastCompleteAfternoonWindow, previousAfternoonWindow, isAfternoonIst, istToUtcIso } from "@/lib/clock";
import {
  completedAfternoonTotals,
  completedTotalsInRange,
  afternoonBands,
  averageOrderValuePaise,
  salesDeltaPct,
  getOpportunities,
} from "@/domain/metrics";
import { getAudience } from "@/domain/consent";

const SESSION = "test-metrics";
let merchantId: string;

beforeAll(() => {
  const db = openTestDb();
  merchantId = resetTenant(db, SESSION);
});

describe("fixture totals (bakery-v1)", () => {
  it("reconciles the two hero windows exactly", () => {
    const db = openTestDb();
    const fixture = loadFixture();
    const now = getNow();
    const currWin = lastCompleteAfternoonWindow(now);
    const prevWin = previousAfternoonWindow(currWin);

    expect(currWin.label).toBe(fixture.windows.current.label);
    expect(prevWin.label).toBe(fixture.windows.previous.label);

    const prev = completedAfternoonTotals(db, merchantId, prevWin);
    const curr = completedAfternoonTotals(db, merchantId, currWin);

    expect(prev.orders).toBe(100);
    expect(prev.netSalesPaise).toBe(800000);
    expect(curr.orders).toBe(70);
    expect(curr.netSalesPaise).toBe(560000);
  });

  it("shows -30% deltas and a flat Rs 80 AOV", () => {
    const db = openTestDb();
    const now = getNow();
    const currWin = lastCompleteAfternoonWindow(now);
    const prevWin = previousAfternoonWindow(currWin);
    const prev = completedAfternoonTotals(db, merchantId, prevWin);
    const curr = completedAfternoonTotals(db, merchantId, currWin);

    expect(salesDeltaPct(curr.orders, prev.orders)).toBe(-30);
    expect(salesDeltaPct(curr.netSalesPaise, prev.netSalesPaise)).toBe(-30);
    expect(averageOrderValuePaise(prev)).toBe(8000);
    expect(averageOrderValuePaise(curr)).toBe(8000);
  });

  it("counts only the five daily 3-6 p.m. bands, not the continuous range", () => {
    const db = openTestDb();
    const currWin = lastCompleteAfternoonWindow(getNow());
    const bands = afternoonBands(currWin.startIso);
    expect(bands).toHaveLength(5);
    expect(bands[0].startIso).toBe("2026-11-02T09:30:00.000Z");
    expect(bands[0].endIso).toBe("2026-11-02T12:30:00.000Z");
    expect(bands[4].endIso).toBe("2026-11-06T12:30:00.000Z");

    // Continuous range would wrongly include Tue-Fri morning orders.
    const continuous = completedTotalsInRange(db, merchantId, currWin.startIso, currWin.endIso);
    const banded = completedAfternoonTotals(db, merchantId, currWin);
    expect(banded.orders).toBe(70);
    expect(continuous.orders).toBeGreaterThan(banded.orders);
  });

  it("excludes pending and canceled orders from completed totals", () => {
    const db = openTestDb();
    const rows = db
      .prepare("SELECT status, COUNT(*) AS n FROM orders WHERE merchant_id = ? GROUP BY status")
      .all(merchantId) as { status: string; n: number }[];
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(byStatus["pending"]).toBe(1);
    expect(byStatus["canceled"]).toBe(1);
    expect(byStatus["completed"]).toBeGreaterThan(0);
  });

  it("reconciles every order with its line items", () => {
    const db = openTestDb();
    const mismatched = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orders o WHERE o.merchant_id = ? AND o.total_paise != (
             SELECT COALESCE(SUM(oi.quantity * (oi.unit_price_paise - oi.unit_discount_paise)), 0)
             FROM order_items oi WHERE oi.order_id = o.id)`
        )
        .get(merchantId) as { n: number }
    ).n;
    expect(mismatched).toBe(0);
  });

  it("returns the hero opportunity with the full evidence chain", () => {
    const db = openTestDb();
    const fixture = loadFixture();
    const ops = getOpportunities(db, merchantId, fixture, getNow());
    expect(ops.items).toHaveLength(1);
    expect(ops.items[0].id).toBe("afternoon-decline-v1");
    expect(ops.items[0].metricIds).toEqual([
      "afternoon-order-delta-v1",
      "afternoon-net-sales-v1",
      "afternoon-aov-v1",
      "bundle-margin-v1",
      "bundle-capacity-v1",
      "audience-consent-v1",
    ]);
    expect(ops.items[0].windows.previous.orders).toBe(100);
    expect(ops.items[0].windows.current.orders).toBe(70);
  });

  it("filters the consented audience (40 eligible / 10 excluded)", () => {
    const db = openTestDb();
    const fixture = loadFixture();
    const audience = getAudience(db, merchantId, fixture.customers.channel);
    expect(audience.eligibleIds).toHaveLength(40);
    expect(audience.excluded).toHaveLength(10);
    expect(audience.excluded.some((e) => e.reason === "consent revoked")).toBe(true);
    expect(audience.excluded.some((e) => e.reason === "no consent on record")).toBe(true);
  });
});

describe("clock and timezone handling", () => {
  it("computes the exact demo windows for the injected clock", () => {
    const currWin = lastCompleteAfternoonWindow(getNow());
    expect(currWin.startIso).toBe("2026-11-02T09:30:00.000Z"); // Mon 2 Nov, 15:00 IST
    expect(currWin.endIso).toBe("2026-11-06T12:30:00.000Z"); // Fri 6 Nov, 18:00 IST
    expect(currWin.label).toBe("2-6 Nov 2026");
    const prevWin = previousAfternoonWindow(currWin);
    expect(prevWin.label).toBe("26-30 Oct 2026");
    expect(prevWin.startIso).toBe("2026-10-26T09:30:00.000Z");
  });

  it("treats Friday before 18:00 IST as an incomplete week", () => {
    // Friday 2026-11-06, 17:00 IST => the current week is not complete yet.
    const at = new Date("2026-11-06T11:30:00.000Z");
    const win = lastCompleteAfternoonWindow(at);
    expect(win.label).toBe("26-30 Oct 2026");
  });

  it("classifies afternoon band edges correctly", () => {
    expect(isAfternoonIst(new Date(istToUtcIso(2026, 11, 2, 14, 59)))).toBe(false);
    expect(isAfternoonIst(new Date(istToUtcIso(2026, 11, 2, 15, 0)))).toBe(true);
    expect(isAfternoonIst(new Date(istToUtcIso(2026, 11, 2, 17, 59)))).toBe(true);
    expect(isAfternoonIst(new Date(istToUtcIso(2026, 11, 2, 18, 0)))).toBe(false);
    expect(isAfternoonIst(new Date(istToUtcIso(2026, 11, 1, 16, 0)))).toBe(false); // Sunday
  });

  it("returns null delta for a zero baseline instead of a misleading number", () => {
    expect(salesDeltaPct(50, 0)).toBeNull();
    expect(salesDeltaPct(0, 0)).toBeNull();
    expect(salesDeltaPct(70, 100)).toBe(-30);
  });
});
