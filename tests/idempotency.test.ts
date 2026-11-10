import { describe, expect, it, beforeAll } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import { draftCampaign, approveCampaign, executeCampaign, redeemEvent, getCampaignResults } from "@/services/campaigns";
import { ApiError } from "@/lib/errors";
import type { SqliteDatabase } from "@/lib/db";

const fixture = loadFixture();

beforeAll(() => {
  // Touch the shared test database once so the schema exists.
  openTestDb();
});

/** Fresh tenant + queued campaign, fully isolated per test. */
async function queuedCampaign(session: string, cap = 20) {
  const db = openTestDb();
  const merchant = resetTenant(db, session);
  const draft = await draftCampaign(db, merchant, fixture, {
    opportunityId: "afternoon-decline-v1",
    pricePaise: 7000,
    cap,
    locale: "en",
  });
  approveCampaign(db, merchant, fixture, draft.campaignId, draft.version, draft.previewHash);
  const receipt = executeCampaign(db, merchant, fixture, draft.campaignId, draft.version);
  return { db, merchant, draft, receipt };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected ApiError ${code}`);
  } catch (err) {
    expect((err as ApiError).code).toBe(code);
  }
}

describe("execution idempotency", () => {
  it("returns the original receipt on repeated execution without double-queueing", async () => {
    const { db, merchant, draft, receipt } = await queuedCampaign("test-idem-exec");
    const again = executeCampaign(db, merchant, fixture, draft.campaignId, draft.version);
    expect(again.duplicate).toBe(true);
    expect(again.count).toBe(receipt.count);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ?").get(draft.campaignId) as { n: number }).n;
    expect(n).toBe(40);
  });

  it("returns the stored receipt when the same client idempotency key is reused", async () => {
    const { db, merchant } = await queuedCampaign("test-idem-key");
    const draft2 = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchant, fixture, draft2.campaignId, draft2.version, draft2.previewHash);
    const first = executeCampaign(db, merchant, fixture, draft2.campaignId, draft2.version, "client-key-001");
    const second = executeCampaign(db, merchant, fixture, draft2.campaignId, draft2.version, "client-key-001");
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.duplicate).toBe(true);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ?").get(draft2.campaignId) as { n: number }).n;
    expect(n).toBe(40);
  });

  it("rejects a reused idempotency key with different input", async () => {
    const db = openTestDb();
    const merchant = resetTenant(db, "test-idem-conflict");

    const a = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchant, fixture, a.campaignId, a.version, a.previewHash);
    executeCampaign(db, merchant, fixture, a.campaignId, a.version, "shared-key");

    const b = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchant, fixture, b.campaignId, b.version, b.previewHash);
    expectCode(() => executeCampaign(db, merchant, fixture, b.campaignId, b.version, "shared-key"), "conflict");
  });

  it("clears client idempotency receipts when the tenant is reset", async () => {
    const db = openTestDb();
    const merchant = resetTenant(db, "test-idem-reset");
    const draft = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchant, fixture, draft.campaignId, draft.version, draft.previewHash);
    executeCampaign(db, merchant, fixture, draft.campaignId, draft.version, "resettable-key");

    // A reset must drop the stored receipt, so the same client key can be used
    // again for a fresh campaign instead of replaying/conflicting.
    const merchant2 = resetTenant(db, "test-idem-reset");
    expect(merchant2).toBe(merchant);
    const draft2 = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchant, fixture, draft2.campaignId, draft2.version, draft2.previewHash);
    const receipt = executeCampaign(db, merchant, fixture, draft2.campaignId, draft2.version, "resettable-key");
    expect(receipt.duplicate).toBe(false);
    expect(receipt.campaignId).toBe(draft2.campaignId);
  });

  it("keeps outbox rows unique per recipient per version", async () => {
    const { db, draft } = await queuedCampaign("test-idem-unique");
    const dupes = db
      .prepare("SELECT customer_id, COUNT(*) AS n FROM outbox WHERE campaign_id = ? GROUP BY customer_id HAVING n > 1")
      .all(draft.campaignId);
    expect(dupes).toHaveLength(0);
  });
});

describe("redemption idempotency and cap", () => {
  it("replaying the same event does not double count", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-dup");
    const first = redeemEvent(db, merchant, fixture, draft.campaignId, "R-001");
    expect(first.redemption.duplicate).toBe(false);
    const replay = redeemEvent(db, merchant, fixture, draft.campaignId, "R-001");
    expect(replay.redemption.duplicate).toBe(true);
    expect(replay.totals.redemptions).toBe(1);
    expect(replay.totals.revenuePaise).toBe(7000);

    const n = (db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ?").get(draft.campaignId) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("produces the exact fixture results after all 10 events", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-full");
    for (const ev of fixture.simulatedRedemptionEvents) {
      redeemEvent(db, merchant, fixture, draft.campaignId, ev.eventId);
    }
    const results = getCampaignResults(db, merchant, fixture, draft.campaignId);
    expect(results.redemptions.redemptions).toBe(10);
    expect(results.redemptions.revenuePaise).toBe(70000);
    expect(results.redemptions.variableCostPaise).toBe(40000);
    expect(results.redemptions.contributionPaise).toBe(30000);
    expect(results.redemptions.discountPaise).toBe(20000);
    expect(results.outbox.queued).toBe(40);
  });

  it("enforces the redemption cap atomically", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-cap", 1);
    redeemEvent(db, merchant, fixture, draft.campaignId, "R-001");
    expectCode(() => redeemEvent(db, merchant, fixture, draft.campaignId, "R-002"), "cap_reached");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ?").get(draft.campaignId) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("rejects unknown event ids", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-unknown");
    expectCode(() => redeemEvent(db, merchant, fixture, draft.campaignId, "R-999"), "not_found");
  });

  it("refuses redemptions before the campaign is queued", async () => {
    const db = openTestDb();
    const merchant = resetTenant(db, "test-redem-prequeue");
    const draft = await draftCampaign(db, merchant, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    expectCode(() => redeemEvent(db, merchant, fixture, draft.campaignId, "R-001"), "business_rule");
  });

  it("stops recording redemptions when component stock runs out", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-stock");
    // Each bundle uses 2 samosas; 3 in stock covers exactly one redemption.
    db.prepare("UPDATE inventory SET quantity = 3 WHERE merchant_id = ? AND sku_id = 'SKU-SAMOSA'").run(merchant);
    redeemEvent(db, merchant, fixture, draft.campaignId, "R-001");
    expectCode(() => redeemEvent(db, merchant, fixture, draft.campaignId, "R-002"), "business_rule");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ?").get(draft.campaignId) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("rejects events whose amount contradicts the approved offer terms", async () => {
    const { db, merchant, draft } = await queuedCampaign("test-redem-tamper");
    // Tamper with the stored offer price: the fixture event amount (Rs 70) no
    // longer matches, and the redemption must be refused.
    const row = db
      .prepare("SELECT offer_json FROM campaigns WHERE merchant_id = ? AND id = ? AND version = ?")
      .get(merchant, draft.campaignId, draft.version) as { offer_json: string };
    const offer = JSON.parse(row.offer_json) as { pricePaise: number };
    offer.pricePaise = 7200;
    db.prepare("UPDATE campaigns SET offer_json = ? WHERE merchant_id = ? AND id = ? AND version = ?").run(
      JSON.stringify(offer),
      merchant,
      draft.campaignId,
      draft.version
    );
    expectCode(() => redeemEvent(db, merchant, fixture, draft.campaignId, "R-001"), "business_rule");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ?").get(draft.campaignId) as { n: number }).n;
    expect(n).toBe(0);
  });

  it("returns not_found for results of a campaign this session does not own", async () => {
    const db = openTestDb();
    const merchant = resetTenant(db, "test-results-unknown");
    expectCode(() => getCampaignResults(db, merchant, fixture, "cmp_doesnotexist00"), "not_found");
  });
});
