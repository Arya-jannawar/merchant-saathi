import type { SqliteDatabase } from "@/lib/db";
import { getNow, isClockInjected, lastCompleteAfternoonWindow, previousAfternoonWindow } from "@/lib/clock";
import { loadFixture } from "@/lib/fixture";
import { seedTenant, resetTenant } from "@/lib/seed";
import { averageOrderValuePaise, completedAfternoonTotals, salesDeltaPct } from "@/domain/metrics";
import { getAudience } from "@/domain/consent";
import { getAiMode } from "@/adapters/ai";

export interface DemoState {
  seeded: boolean;
  sessionId: string;
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

export function ensureTenant(db: SqliteDatabase, sessionId: string): string {
  const existing = db.prepare("SELECT id FROM merchants WHERE demo_session_id = ?").get(sessionId) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  return seedTenant(db, sessionId);
}

export function getDemoState(db: SqliteDatabase, sessionId: string): DemoState {
  const fixture = loadFixture();
  const now = getNow();
  const merchant = db.prepare("SELECT * FROM merchants WHERE demo_session_id = ?").get(sessionId) as
    | { id: string; display_name: string; fixture_version: string; timezone: string; currency: string }
    | undefined;

  const base = {
    seeded: Boolean(merchant),
    sessionId,
    nowIso: now.toISOString(),
    clockInjected: isClockInjected(),
    aiMode: getAiMode(),
  };

  if (!merchant) {
    return { ...base, hint: "Load the sample data to explore the demo bakery." };
  }

  const currWin = lastCompleteAfternoonWindow(now);
  const prevWin = previousAfternoonWindow(currWin);
  const prev = completedAfternoonTotals(db, merchant.id, prevWin);
  const curr = completedAfternoonTotals(db, merchant.id, currWin);
  const audience = getAudience(db, merchant.id, fixture.customers.channel);

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

export function resetDemo(db: SqliteDatabase, sessionId: string): { fixtureVersion: string; merchantName: string } {
  const fixture = loadFixture();
  resetTenant(db, sessionId);
  return { fixtureVersion: fixture.fixtureVersion, merchantName: fixture.merchant.displayName };
}
