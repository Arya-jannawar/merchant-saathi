import fs from "node:fs";
import path from "node:path";

/**
 * bakery-v1 fixture: the single source of truth for every demo number.
 * Loaded from disk (server-side only) so scripts, tests and the app read the
 * exact same file. All amounts are integer paise.
 */

export interface FixtureSku {
  id: string;
  name: string;
  pricePaise: number;
  unitVariableCostPaise: number;
}

export interface FixtureInventoryItem {
  skuId: string;
  quantity: number;
  unitVariableCostPaise: number;
}

export type FixtureVersion = "bakery-v1" | "bakery-thin-v1";

export interface Fixture {
  fixtureVersion: string;
  definitionVersion: string;
  merchant: { displayName: string; timezone: string; currency: string };
  clock: { nowIso: string };
  policy: { minMarginPct: number; minCompletedOrdersPerWindow: number; declineThresholdPct: number };
  skus: FixtureSku[];
  inventory: FixtureInventoryItem[];
  bundle: {
    id: string;
    name: string;
    components: { skuId: string; quantity: number }[];
    normalPricePaise: number;
    proposedPricePaise: number;
    cap: number;
  };
  windows: {
    previous: {
      label: string;
      mondayIsoDate: string;
      completedAfternoonOrders: number;
      netSalesPaise: number;
      /** Explicit per-order totals (rupees -> count). Must sum to netSalesPaise/100. */
      orderDistribution?: Record<string, number>;
    };
    current: {
      label: string;
      mondayIsoDate: string;
      completedAfternoonOrders: number;
      netSalesPaise: number;
      orderDistribution?: Record<string, number>;
    };
  };
  customers: { total: number; activeSms: number; revokedSms: number; noConsent: number; channel: string; consentSources: string[] };
  campaign: { validity: string; redemptionCap: number; maxDiscountExposurePaise: number };
  simulatedResult: {
    uniqueRedemptions: number;
    revenuePaise: number;
    variableCostPaise: number;
    contributionPaise: number;
    discountPaise: number;
  };
  simulatedRedemptionEvents: {
    eventId: string;
    customerId: string;
    quantity: number;
    amountPaise: number;
    occurredAtIso: string;
  }[];
}

export function loadFixture(version: FixtureVersion = "bakery-v1"): Fixture {
  const fixturePath = path.resolve(process.cwd(), "src", "fixtures", `${version}.json`);
  const raw = fs.readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as Fixture;
}
