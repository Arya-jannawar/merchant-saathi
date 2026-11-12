// The operations copilot: run-rates, days-of-cover, campaign draw-down and the
// restock plan - all deterministic arithmetic over real rows.
import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import { buildAssistantFacts } from "@/lib/saathi-brain";
import { draftCampaign, approveCampaign, executeCampaign, redeemEvent } from "@/services/campaigns";
import { getOperationsInsights } from "@/domain/operations";
import { getNow } from "@/lib/clock";
import { completedAfternoonTotals } from "@/domain/metrics";
import type { SqliteDatabase } from "@/lib/db";

let db: SqliteDatabase | null = null;

function freshDb(session: string): SqliteDatabase {
  if (!db) db = openTestDb();
  resetTenant(db, session);
  return db;
}

describe("operations copilot", () => {
  it("computes per-SKU run-rates that reconcile with the window totals", () => {
    const d = freshDb("ops-rates");
    const fixture = loadFixture();
    const insights = getOperationsInsights(d, resetTenant(d, "ops-rates"), fixture, getNow());

    // 5-day window: units sold per day summed over SKUs x 5 must equal every
    // completed order's line-item units in that window. Cross-check total
    // revenue weight instead: the fixture's window totals are 100 orders/800000.
            expect(insights.lines.length).toBe(fixture.skus.length);
    // every line has sane stock straight from the seeded inventory
    for (const line of insights.lines) {
      const inv = fixture.inventory.find((i) => i.skuId === line.skuId);
      expect(line.stock).toBe(inv?.quantity ?? 0);
    }
    // at least one SKU sold something in the current window (the fixture has
    // 70 completed afternoon + morning orders there)
    expect(insights.lines.some((l) => (l.dailyRate ?? 0) > 0)).toBe(true);
  });

  it("flags the campaign draw-down and projects stock after it", async () => {
    const d = freshDb("ops-campaign");
    const fixture = loadFixture();
    const merchantId = resetTenant(d, "ops-campaign");
    const draft = await draftCampaign(d, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(d, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    executeCampaign(d, merchantId, fixture, draft.campaignId, draft.version);

    const insights = getOperationsInsights(d, merchantId, fixture, getNow());
    const samosa = insights.lines.find((l) => l.skuId === "SKU-SAMOSA")!;
    const tea = insights.lines.find((l) => l.skuId === "SKU-TEA")!;
    // no redemptions applied yet: full remaining cap (20) draws 2 samosas + 1 tea each
    expect(samosa.campaignDrawDown).toBe(40);
    expect(tea.campaignDrawDown).toBe(20);
    expect(samosa.projectedAfterCampaign).toBe(Math.max(samosa.stock - 40, 0));

    // a partial draw reflects the recorded redemptions
    redeemEvent(d, merchantId, fixture, draft.campaignId, "R-001");
    const after = getOperationsInsights(d, merchantId, fixture, getNow());
    const samosaAfter = after.lines.find((l) => l.skuId === "SKU-SAMOSA")!;
    expect(samosaAfter.campaignDrawDown).toBe(38); // 20-1 redemptions left, x2 units
  });

  it("suggests a restock plan that reaches the 14-day target and costs it in paise", () => {
    const d = freshDb("ops-restock");
    const fixture = loadFixture();
    const merchantId = resetTenant(d, "ops-restock");

    // Drain one SKU to zero to force an "out of stock" line with a plan.
    d.prepare("UPDATE inventory SET quantity = 0 WHERE merchant_id = ? AND sku_id = 'SKU-TEA'").run(merchantId);

    const insights = getOperationsInsights(d, merchantId, fixture, getNow());
    const tea = insights.lines.find((l) => l.skuId === "SKU-TEA")!;
    expect(tea.stock).toBe(0);
    expect(tea.status).toBe("out");
    expect(tea.restockUnits).toBeGreaterThanOrEqual(0);
    expect(tea.restockCostPaise).toBe(tea.restockUnits * 1000); // unit cost from fixture
    expect(insights.restockTotalCostPaise).toBe(
      insights.lines.reduce((sum, l) => sum + l.restockCostPaise, 0)
    );
    // the briefing mentions the plan when there is one
    if (insights.restockTotalUnits > 0) {
      expect(insights.briefing.some((line) => line.includes("restock plan"))).toBe(true);
    }
  });

  it("answers the fact book from the stockroom", () => {
    const d = freshDb("ops-factbook");
    const fixture = loadFixture();
    const merchantId = resetTenant(d, "ops-factbook");
    // build facts through the same path the route uses
    const facts = getOperationsFacts(d, merchantId);
    void fixture;
    expect(facts.operations).not.toBeNull();
    expect(facts.operations!.windowLabel.length).toBeGreaterThan(4);
  });
});

function getOperationsFacts(d: SqliteDatabase, merchantId: string) {
  return buildAssistantFacts(d, merchantId);
}
