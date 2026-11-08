import type { SqliteDatabase } from "@/lib/db";
import type { Fixture } from "@/lib/fixture";
import { formatINR, formatPct } from "@/lib/money";

/**
 * Pure offer economics. The AI never performs money arithmetic - these
 * functions own every number that appears in offer terms.
 */

export interface OfferComputation {
  pricePaise: number;
  normalPricePaise: number;
  bundleCostPaise: number | null;
  contributionPaise: number | null;
  marginPct: number | null;
  floorPct: number;
  passes: boolean;
  violations: string[];
  capacity: number;
  requestedCap: number;
  capWithinCapacity: boolean;
  discountPaise: number;
  discountPct: number;
  maxDiscountExposurePaise: number;
  atCap: {
    bundles: number;
    revenuePaise: number;
    variableCostPaise: number;
    contributionPaise: number;
    remainingBySku: { skuId: string; quantity: number }[];
  } | null;
}

export function computeOffer(
  db: SqliteDatabase,
  merchantId: string,
  fixture: Fixture,
  pricePaise: number,
  requestedCap: number
): OfferComputation {
  const floorPct = fixture.policy.minMarginPct;

  // Live stock + unit costs from the inventory table (not the fixture copy).
  const invRows = db
    .prepare("SELECT sku_id, quantity, unit_variable_cost_paise FROM inventory WHERE merchant_id = ?")
    .all(merchantId) as { sku_id: string; quantity: number; unit_variable_cost_paise: number | null }[];
  const invBySku = new Map(invRows.map((r) => [r.sku_id, r]));

  let capacity = Number.POSITIVE_INFINITY;
  const missingCostSkus: string[] = [];
  for (const c of fixture.bundle.components) {
    const row = invBySku.get(c.skuId);
    if (!row) {
      capacity = 0;
      missingCostSkus.push(c.skuId);
      continue;
    }
    if (row.unit_variable_cost_paise === null) missingCostSkus.push(c.skuId);
    capacity = Math.min(capacity, Math.floor(row.quantity / c.quantity));
  }
  if (!Number.isFinite(capacity)) capacity = 0;

  const bundleCostPaise =
    missingCostSkus.length === 0
      ? fixture.bundle.components.reduce((sum, c) => {
          const row = invBySku.get(c.skuId);
          return sum + (row?.unit_variable_cost_paise ?? 0) * c.quantity;
        }, 0)
      : null;

  const contributionPaise = bundleCostPaise === null ? null : pricePaise - bundleCostPaise;
  const marginPct =
    contributionPaise === null || pricePaise <= 0 ? null : Math.round((contributionPaise / pricePaise) * 100000) / 1000;

  const violations: string[] = [];
  if (pricePaise <= 0) violations.push("Price must be greater than zero.");
  if (bundleCostPaise === null) {
    violations.push(
      `Cannot calculate margin: missing variable cost for ${missingCostSkus.join(", ")}. Missing cost is treated as unknown, never as zero.`
    );
  } else if (marginPct !== null && marginPct < floorPct) {
    violations.push(
      `Margin ${formatPct(marginPct / 100)} is below the ${floorPct}% floor. ${formatINR(pricePaise - (bundleCostPaise ?? 0))} left after ${formatINR(
        bundleCostPaise ?? 0
      )} variable cost.`
    );
  }
  if (!Number.isInteger(requestedCap) || requestedCap < 1) violations.push("Redemption cap must be a whole number of at least 1.");
  const capWithinCapacity = Number.isInteger(requestedCap) && requestedCap >= 1 && requestedCap <= capacity;
  if (Number.isInteger(requestedCap) && requestedCap >= 1 && !capWithinCapacity) {
    violations.push(
      `Requested cap ${requestedCap} exceeds physical stock capacity of ${capacity} bundles. Revise the cap or restock - it will not be silently lowered.`
    );
  }

  const discountPaise = fixture.bundle.normalPricePaise > 0 ? fixture.bundle.normalPricePaise - pricePaise : 0;
  const discountPct = fixture.bundle.normalPricePaise > 0 ? Math.round((discountPaise / fixture.bundle.normalPricePaise) * 100000) / 1000 : 0;
  const bundlesAtCap = Math.max(0, Math.min(Math.max(requestedCap, 0), capacity));

  const atCap =
    bundleCostPaise === null
      ? null
      : {
          bundles: bundlesAtCap,
          revenuePaise: pricePaise * bundlesAtCap,
          variableCostPaise: bundleCostPaise * bundlesAtCap,
          contributionPaise: (pricePaise - bundleCostPaise) * bundlesAtCap,
          remainingBySku: fixture.bundle.components.map((c) => {
            const row = invBySku.get(c.skuId);
            const stock = row?.quantity ?? 0;
            return { skuId: c.skuId, quantity: stock - c.quantity * bundlesAtCap };
          }),
        };

  const maxDiscountExposurePaise = Math.max(0, discountPaise) * bundlesAtCap;

  return {
    pricePaise,
    normalPricePaise: fixture.bundle.normalPricePaise,
    bundleCostPaise,
    contributionPaise,
    marginPct,
    floorPct,
    passes: violations.length === 0,
    violations,
    capacity,
    requestedCap,
    capWithinCapacity,
    discountPaise,
    discountPct,
    maxDiscountExposurePaise,
    atCap,
  };
}
