// Mithu's brain: intent routing, the fact book, the monetary guard for live
// answers, and the in-memory key settings store.
import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "./helpers";
import { resetTenant, merchantIdFor, DEFAULT_VARIANT_SEED } from "@/lib/seed";
import { draftCampaign, approveCampaign, executeCampaign, redeemEvent } from "@/services/campaigns";
import { loadFixture } from "@/lib/fixture";
import {
  allowedRupeeAmounts,
  answerFromFactBook,
  assistantMonetaryTermsValid,
  buildAssistantFacts,
  matchIntent,
  parseAssistantAnswer,
} from "@/lib/saathi-brain";
import {
  assistantKeyStatus,
  clearAssistantKeyConfig,
  setAssistantKeyConfig,
} from "@/lib/assistant-settings";
import { ApiError } from "@/lib/errors";
import type { SqliteDatabase } from "@/lib/db";

let db: SqliteDatabase | null = null;

function freshDb(session: string): SqliteDatabase {
  if (!db) db = openTestDb();
  resetTenant(db, session);
  return db;
}

function merchantFor(session: string): string {
  return merchantIdFor(session, DEFAULT_VARIANT_SEED);
}

afterEach(() => {
  clearAssistantKeyConfig();
});

describe("matchIntent", () => {
  it("routes the demo's core questions", () => {
    expect(matchIntent("Why are afternoon orders down?")).toBe("decline");
    expect(matchIntent("Is the ₹70 offer safe?")).toBe("offer");
    expect(matchIntent("What does approving do?")).toBe("approve");
    expect(matchIntent("How much money did the campaign make?")).toBe("results");
    expect(matchIntent("hi there")).toBe("greet");
    expect(matchIntent("what is the weather on Mars")).toBe("general");
  });
});

describe("assistantMonetaryTermsValid", () => {
  const allowed = allowedRupeeAmounts({
    kpis: {
      previous: { label: "a", orders: 100, netSalesPaise: 800000, aovPaise: 8000 },
      current: { label: "b", orders: 70, netSalesPaise: 560000, aovPaise: 8000 },
      ordersDeltaPct: -30,
      salesDeltaPct: -30,
    },
    economics: { pricePaise: 7000, normalPricePaise: 9000, bundleCostPaise: 4000, contributionPaise: 3000, marginPct: 42.9, floorPct: 25, passes: true, capacity: 25, requestedCap: 20, maxDiscountExposurePaise: 40000, discountPct: 22.2 },
    campaign: null,
    opportunity: null,
    operations: null,
    lowDataReason: null,
    merchantName: "x",
    fixtureVersion: "bakery-v1",
    aiMode: "fixture",
    clockInjected: true,
    nowIso: "2026-11-06T13:30:00.000Z",
    seeded: true,
    audience: null,
  });

  it("accepts rupee amounts that exist in the computed facts", () => {
    expect(assistantMonetaryTermsValid("Net sales went ₹8,000 → ₹5,600 and the price is ₹70.", allowed)).toBe(true);
    expect(assistantMonetaryTermsValid("Rs 5600 without grouping is fine too.", allowed)).toBe(true);
  });

  it("rejects invented amounts", () => {
    expect(assistantMonetaryTermsValid("You could make ₹9,999 more!", allowed)).toBe(false);
    expect(assistantMonetaryTermsValid("This combo costs INR 45 everywhere.", allowed)).toBe(false);
  });
});

describe("fact book against a seeded tenant", () => {
  it("answers the decline question from the window totals", () => {
    const d = freshDb("assistant-decline");
    const facts = buildAssistantFacts(d, merchantFor("assistant-decline"));
    expect(facts.seeded).toBe(true);
    expect(facts.economics).not.toBeNull();
    expect(facts.economics?.passes).toBe(true);
    const a = answerFromFactBook("why are afternoon orders down?", facts);
    expect(a.intent).toBe("decline");
    expect(a.answer).toContain("100");
    expect(a.answer).toContain("70");
    expect(a.answer).toContain("order COUNT");
    // no causal claims
    expect(a.answer.toLowerCase()).not.toMatch(/because of|caused by/);
  });

  it("reports the offer math with the floor and the ₹50 rejection", () => {
    const d = freshDb("assistant-offer");
    const facts = buildAssistantFacts(d, merchantFor("assistant-offer"));
    const a = answerFromFactBook("is the ₹70 offer safe?", facts);
    expect(a.answer).toContain("42.9%");
    expect(a.answer).toContain("25%");
    expect(a.answer).toContain("₹50");
    expect(a.answer).toContain("20%");
  });

  it("says there are no results before a campaign is queued, then the ₹300 story after", async () => {
    const d = freshDb("assistant-results");
    const fixture = loadFixture();
    const merchantId = resetTenant(d, "assistant-results");
    const factsBefore = buildAssistantFacts(d, merchantFor("assistant-results"));
    expect(answerFromFactBook("how much money did the campaign make?", factsBefore).answer).toContain("no queued campaign");

    const draft = await draftCampaign(d, merchantId, fixture, {
      opportunityId: "afternoon-decline-v1",
      pricePaise: fixture.bundle.proposedPricePaise,
      cap: fixture.bundle.cap,
      locale: "en",
    });
    approveCampaign(d, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
    executeCampaign(d, merchantId, fixture, draft.campaignId, draft.version);

    const factsQueued = buildAssistantFacts(d, merchantFor("assistant-results"));
    expect(answerFromFactBook("how much money did the campaign make?", factsQueued).answer).toContain("no redemption events have been applied");

    for (const event of fixture.simulatedRedemptionEvents) {
      redeemEvent(d, merchantId, fixture, draft.campaignId, event.eventId);
    }

    const factsAfter = buildAssistantFacts(d, merchantFor("assistant-results"));
    const a = answerFromFactBook("how much money did the campaign make?", factsAfter);
    expect(a.answer).toContain("₹700");
    expect(a.answer).toContain("₹400");
    expect(a.answer).toContain("₹300");
    expect(a.answer).toContain("simulated");
  });
});

describe("live answer parsing", () => {
  const facts = buildAssistantFacts(freshDb("assistant-parse"), merchantFor("assistant-parse"));

  it("accepts a well-formed, grounded answer (with or without fences)", () => {
    const raw = '```json\n{"answer":"Orders fell 30% and AOV is ₹80.","reasoning":["Compared the two windows"],"followUps":["Is ₹70 safe?"]}\n```';
    const parsed = parseAssistantAnswer(raw, facts);
    expect(parsed.answer).toContain("30%");
    expect(parsed.reasoning.length).toBe(1);
  });

  it("rejects non-JSON and invented rupee amounts", () => {
    expect(() => parseAssistantAnswer("I think it is fine.", facts)).toThrow();
    expect(() =>
      parseAssistantAnswer(
        JSON.stringify({ answer: "Raise prices to ₹120 to fix everything.", reasoning: ["guess"], followUps: [] }),
        facts
      )
    ).toThrow(/rupee amounts/);
  });
});

describe("assistant key settings", () => {
  it("stores, masks and clears the key without ever exposing it", () => {
    const cfg = setAssistantKeyConfig({ apiKey: "super-secret-key-42", model: "test-model", baseUrl: "https://api.z.ai/api/paas/v4" });
    expect(cfg.model).toBe("test-model");
    const status = assistantKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.maskedKey).toBe("\u2022\u2022\u2022\u2022y-42");
    expect(JSON.stringify(status)).not.toContain("super-secret-key-42");
    clearAssistantKeyConfig();
    expect(assistantKeyStatus().configured).toBe(false);
  });

  it("refuses private endpoints and bad key shapes", () => {
    expect(() => setAssistantKeyConfig({ apiKey: "super-secret-key-42", model: "m", baseUrl: "http://127.0.0.1:8080/v1" })).toThrow(ApiError);
    expect(() => setAssistantKeyConfig({ apiKey: "short", model: "m" })).toThrow(ApiError);
    expect(() => setAssistantKeyConfig({ apiKey: "super-secret-key-42", model: "bad model id!" })).toThrow(ApiError);
    expect(assistantKeyStatus().configured).toBe(false);
  });
});
