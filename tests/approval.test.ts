import { describe, expect, it, beforeAll } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import {
  draftCampaign,
  approveCampaign,
  executeCampaign,
} from "@/services/campaigns";
import { ApiError } from "@/lib/errors";

const SESSION = "test-approval";
let merchantId: string;
const fixture = loadFixture();

beforeAll(() => {
  const db = openTestDb();
  merchantId = resetTenant(db, SESSION);
});

function expectApiError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected ApiError ${code} but nothing was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
  }
}

describe("approval lifecycle", () => {
  it("approves the exact previewed version and queues it", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    const approval = approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    expect(approval.approvedVersion).toBe(draft.version);

    const receipt = executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version);
    expect(receipt.status).toBe("simulated_queued");
    expect(receipt.count).toBe(40);
    expect(receipt.duplicate).toBe(false);

    const outboxCount = (
      db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ? AND version = ?").get(draft.campaignId, draft.version) as { n: number }
    ).n;
    expect(outboxCount).toBe(40);
  });

  it("rejects approval when the client hash does not match the stored preview", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    const wrongHash = "a".repeat(64);
    expectApiError(() => approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, wrongHash), "stale_preview");
  });

  it("refuses to approve an unprofitable offer", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 5000, // 20% margin - below floor
      cap: 20,
      locale: "en",
    });
    expectApiError(
      () => approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash),
      "business_rule"
    );
  });

  it("rejects execution of an unapproved draft", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    expectApiError(() => executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version), "conflict");
  });

  it("blocks execution when consent changed after approval", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    db.prepare("UPDATE consents SET status='revoked', revoked_at=? WHERE customer_id LIKE '%CUST-002'").run(new Date().toISOString());
    expectApiError(() => executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version), "stale_consent");
    // restore for later tests
    db.prepare("UPDATE consents SET status='active', revoked_at=NULL WHERE customer_id LIKE '%CUST-002'").run();
  });

  it("blocks execution when stock version changed after approval", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    db.prepare("UPDATE inventory SET version = version + 1 WHERE merchant_id = ?").run(merchantId);
    expectApiError(() => executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version), "stale_inventory");
    db.prepare("UPDATE inventory SET version = 1 WHERE merchant_id = ?").run(merchantId);
  });

  it("a newer draft supersedes an older approved version", async () => {
    const db = openTestDb();
    const v1 = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchantId, fixture, v1.campaignId, v1.version, v1.previewHash);
    const v2 = await draftCampaign(db, merchantId, fixture, {
      campaignId: v1.campaignId,
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7200,
      cap: 15,
      locale: "en",
    });
    expect(v2.version).toBe(v1.version + 1);
    expectApiError(() => executeCampaign(db, merchantId, fixture, v1.campaignId, v1.version), "stale_version");
  });

  it("refuses to approve a version that was already queued", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version);
    expectApiError(
      () => approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash),
      "stale_version"
    );
  });

  it("refuses to approve a draft version that is no longer the latest", async () => {
    const db = openTestDb();
    const v1 = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    await draftCampaign(db, merchantId, fixture, {
      campaignId: v1.campaignId,
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7200,
      cap: 15,
      locale: "en",
    });
    expectApiError(
      () => approveCampaign(db, merchantId, fixture, v1.campaignId, v1.version, v1.previewHash),
      "stale_version"
    );
  });

  it("blocks approval when the consent register changed since the preview", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    db.prepare("UPDATE consents SET status='revoked', revoked_at=? WHERE customer_id LIKE '%CUST-005'").run(
      new Date().toISOString()
    );
    expectApiError(
      () => approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash),
      "stale_preview"
    );
    // restore for later tests
    db.prepare("UPDATE consents SET status='active', revoked_at=NULL WHERE customer_id LIKE '%CUST-005'").run();
  });

  it("blocks execution after the offer validity window has passed", async () => {
    const db = openTestDb();
    const draft = await draftCampaign(db, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    // Drafted at the fixture clock (Fri 6 Nov 2026, 7:00 p.m. IST) the offer is
    // valid until the next weekday evening (Mon 9 Nov, 6:00 p.m. IST). Move the
    // injected clock past that instant and execution must refuse.
    const savedNow = process.env.DEMO_NOW;
    process.env.DEMO_NOW = "2026-11-09T18:30:00+05:30";
    try {
      expectApiError(() => executeCampaign(db, merchantId, fixture, draft.campaignId, draft.version), "expired");
    } finally {
      if (savedNow === undefined) delete process.env.DEMO_NOW;
      else process.env.DEMO_NOW = savedNow;
    }
  });

  it("refuses a draft whose campaign id belongs to another session", async () => {
    const db = openTestDb();
    // Tenant A drafts a campaign; tenant B must not be able to extend that id.
    const merchantA = resetTenant(db, "test-approval-xtenant-a");
    const draftA = await draftCampaign(db, merchantA, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    try {
      await draftCampaign(db, merchantId, fixture, {
        campaignId: draftA.campaignId,
        opportunityId: "afternoon-decline-v1",
        pricePaise: 7000,
        cap: 20,
        locale: "en",
      });
      throw new Error("Expected ApiError not_found for a foreign campaign id");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("not_found");
    }
    // ...and the id must still be usable by its own tenant.
    const draftA2 = await draftCampaign(db, merchantA, fixture, {
      campaignId: draftA.campaignId,
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    expect(draftA2.campaignId).toBe(draftA.campaignId);
    expect(draftA2.version).toBe(draftA.version + 1);
  });
});
