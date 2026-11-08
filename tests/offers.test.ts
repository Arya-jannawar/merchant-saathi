import { describe, expect, it, beforeAll } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import { computeOffer } from "@/domain/offers";
import { computeBundleCapacity } from "@/domain/metrics";

const SESSION = "test-offers";
let merchantId: string;

beforeAll(() => {
  const db = openTestDb();
  merchantId = resetTenant(db, SESSION);
});

describe("offer economics", () => {
  const fixture = loadFixture();

  it("validates the hero offer: Rs 70 passes with 42.857% margin", () => {
    const db = openTestDb();
    const c = computeOffer(db, merchantId, fixture, 7000, 20);
    expect(c.bundleCostPaise).toBe(4000);
    expect(c.contributionPaise).toBe(3000);
    expect(c.marginPct).toBeCloseTo(42.857, 3);
    expect(c.passes).toBe(true);
    expect(c.violations).toHaveLength(0);
    expect(c.capacity).toBe(25);
    expect(c.capWithinCapacity).toBe(true);
    expect(c.maxDiscountExposurePaise).toBe(40000);
    expect(c.atCap).toEqual({
      bundles: 20,
      revenuePaise: 140000,
      variableCostPaise: 80000,
      contributionPaise: 60000,
      remainingBySku: [
        { skuId: "SKU-SAMOSA", quantity: 20 },
        { skuId: "SKU-TEA", quantity: 5 },
      ],
    });
  });

  it("rejects Rs 50: 20% margin is below the 25% floor", () => {
    const db = openTestDb();
    const c = computeOffer(db, merchantId, fixture, 5000, 20);
    expect(c.contributionPaise).toBe(1000);
    expect(c.marginPct).toBeCloseTo(20.0, 3);
    expect(c.passes).toBe(false);
    expect(c.violations.some((v) => v.includes("below the 25% floor"))).toBe(true);
  });

  it("rejects zero and negative prices", () => {
    const db = openTestDb();
    expect(computeOffer(db, merchantId, fixture, 0, 20).passes).toBe(false);
    expect(computeOffer(db, merchantId, fixture, -100, 20).violations.some((v) => v.includes("greater than zero"))).toBe(true);
  });

  it("treats a missing SKU cost as unknown, never as zero", () => {
    const db = openTestDb();
    db.prepare("UPDATE inventory SET unit_variable_cost_paise = NULL WHERE merchant_id = ? AND sku_id = 'SKU-TEA'").run(merchantId);
    const c = computeOffer(db, merchantId, fixture, 7000, 20);
    expect(c.bundleCostPaise).toBeNull();
    expect(c.contributionPaise).toBeNull();
    expect(c.atCap).toBeNull();
    expect(c.passes).toBe(false);
    expect(c.violations.some((v) => v.includes("Cannot calculate margin"))).toBe(true);
    // restore
    db.prepare("UPDATE inventory SET unit_variable_cost_paise = 1000 WHERE merchant_id = ? AND sku_id = 'SKU-TEA'").run(merchantId);
  });

  it("refuses to silently lower a cap above physical capacity", () => {
    const db = openTestDb();
    const c = computeOffer(db, merchantId, fixture, 7000, 30);
    expect(c.capacity).toBe(25);
    expect(c.capWithinCapacity).toBe(false);
    expect(c.passes).toBe(false);
    expect(c.violations.some((v) => v.includes("will not be silently lowered"))).toBe(true);
  });

  it("rejects caps below one", () => {
    const db = openTestDb();
    expect(computeOffer(db, merchantId, fixture, 7000, 0).passes).toBe(false);
  });

  it("enforces non-negative stock at the database level", () => {
    const db = openTestDb();
    expect(() =>
      db.prepare("UPDATE inventory SET quantity = -1 WHERE merchant_id = ? AND sku_id = 'SKU-SAMOSA'").run(merchantId)
    ).toThrowError();
  });

  it("computes capacity from stock counts", () => {
    expect(computeBundleCapacity(fixture)).toBe(25); // min(floor(60/2), floor(25/1))
  });
});
