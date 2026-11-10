// Multi-business sessions: creation caps, ownership guards, per-business data
// isolation, insights correctness, and variant reset behavior.
import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers";
import {
  createMerchant,
  getDemoInsights,
  getDemoState,
  listMerchants,
  resolveMerchant,
  removeMerchant,
  MerchantLimitError,
  MerchantNotFoundError,
  MAX_MERCHANTS_PER_SESSION,
} from "@/services/demo";
import { resetMerchantById, resetTenant, merchantIdFor, DEFAULT_VARIANT_SEED } from "@/lib/seed";
import { loadFixture } from "@/lib/fixture";
import { draftCampaign } from "@/services/campaigns";
import { completedAfternoonTotals } from "@/domain/metrics";
import { lastCompleteAfternoonWindow, previousAfternoonWindow, getNow } from "@/lib/clock";
import { ApiError } from "@/lib/errors";
import type { SqliteDatabase } from "@/lib/db";

let db: SqliteDatabase | null = null;

/** Wipe every business the session owns (they persist across runs on the shared
 * test database), then seed a fresh default. */
function freshDb(session: string): SqliteDatabase {
  if (!db) db = openTestDb();
  for (const m of listMerchants(db, session)) {
    removeMerchant(db, session, m.id);
  }
  resetTenant(db, session);
  return db;
}

describe("multi-merchant sessions", () => {
  it("adds businesses with distinct names, ids and non-identical data", () => {
    const d = freshDb("merchants-basic");
    const second = createMerchant(d, "merchants-basic");
    const list = listMerchants(d, "merchants-basic");
    expect(list.length).toBe(2);
    expect(list[0].isDefault).toBe(true);
    expect(list[1].isDefault).toBe(false);
    expect(second.id).not.toBe(list[0].id);
    expect(second.name.length).toBeGreaterThan(0);
    // Variant data is deterministic but different: the two hero windows differ.
    const now = getNow();
    const a = getDemoState(d, "merchants-basic", list[0].id).kpis!;
    const b = getDemoState(d, "merchants-basic", second.id).kpis!;
    expect(a.current.orders).toBe(70); // default business keeps the fixture numbers
    expect(b.current.orders).not.toBe(a.current.orders);
    expect(b.previous.orders).toBeGreaterThan(b.current.orders); // still a decline story
  });

  it("honors a requested owned merchant and refuses foreign ids without leaking them", () => {
    const d = freshDb("merchants-ownership");
    const mine = createMerchant(d, "merchants-ownership");
    // A different session's default merchant id.
    const foreignId = merchantIdFor("another-session-entirely", DEFAULT_VARIANT_SEED);
    expect(resolveMerchant(d, "merchants-ownership", mine.id).merchantId).toBe(mine.id);
    expect(() => resolveMerchant(d, "merchants-ownership", foreignId)).toThrow(MerchantNotFoundError);
    try {
      resolveMerchant(d, "merchants-ownership", foreignId);
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantNotFoundError);
    }
  });

  it("caps how many businesses one session can add", () => {
    const d = freshDb("merchants-cap");
    for (let i = 1; i < MAX_MERCHANTS_PER_SESSION; i++) {
      createMerchant(d, "merchants-cap");
    }
    expect(() => createMerchant(d, "merchants-cap")).toThrow(MerchantLimitError);
    try {
      createMerchant(d, "merchants-cap");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantLimitError);
    }
  });

  it("resets a variant business in place (same id, same personality)", () => {
    const d = freshDb("merchants-reset");
    const created = createMerchant(d, "merchants-reset", "Zoya's Bake Studio");
    const before = getDemoState(d, "merchants-reset", created.id).kpis!;
    resetMerchantById(d, "merchants-reset", created.id);
    const after = getDemoState(d, "merchants-reset", created.id).kpis!;
    expect(after.current.orders).toBe(before.current.orders);
    expect(after.previous.orders).toBe(before.previous.orders);
    const list = listMerchants(d, "merchants-reset");
    expect(list.find((m) => m.id === created.id)?.name).toBe("Zoya's Bake Studio");
  });

  it("removes a business and leaves the others untouched", () => {
    const d = freshDb("merchants-remove");
    const extra = createMerchant(d, "merchants-remove");
    removeMerchant(d, "merchants-remove", extra.id);
    const list = listMerchants(d, "merchants-remove");
    expect(list.length).toBe(1);
    expect(list[0].isDefault).toBe(true);
  });
});

describe("demo insights", () => {
  it("per-day afternoon series reconciles with the window totals", () => {
    const d = freshDb("merchants-insights");
    const merchantId = resolveMerchant(d, "merchants-insights").merchantId!;
    const now = getNow();
    const insights = getDemoInsights(d, merchantId, now);
    expect(insights.days.previous.length).toBe(5);
    expect(insights.days.current.length).toBe(5);
    const currWin = lastCompleteAfternoonWindow(now);
    const prevWin = previousAfternoonWindow(currWin);
    const prevTotals = completedAfternoonTotals(d, merchantId, prevWin);
    const currTotals = completedAfternoonTotals(d, merchantId, currWin);
    const sumPrev = insights.days.previous.reduce((n, day) => n + day.orders, 0);
    const sumCurr = insights.days.current.reduce((n, day) => n + day.orders, 0);
    expect(sumPrev).toBe(prevTotals.orders);
    expect(sumCurr).toBe(currTotals.orders);
    expect(sumPrev).toBe(100);
    expect(sumCurr).toBe(70);
  });

  it("funnel reports the audience stages and stays null before queueing", async () => {
    const d = freshDb("merchants-funnel");
    const merchantId = resolveMerchant(d, "merchants-funnel").merchantId!;
    const insights = getDemoInsights(d, merchantId, getNow());
    // No campaign yet -> the whole funnel stays hidden (null).
    expect(insights.funnel).toBeNull();
    // A draft creates the campaign row; the funnel appears with later stages null.
    const draft = await draftCampaign(d, merchantId, loadFixture(), {
      opportunityId: "afternoon-decline-v1",
      pricePaise: 7000,
      cap: 20,
      locale: "en",
    });
    const afterDraft = getDemoInsights(d, merchantId, getNow());
    expect(afterDraft.funnel).not.toBeNull();
    expect(afterDraft.funnel?.customers).toBe(50);
    expect(afterDraft.funnel?.eligible).toBe(40);
    expect(afterDraft.funnel?.queued).toBeNull();
    expect(afterDraft.funnel?.redemptions).toBeNull();
    expect(afterDraft.funnel?.simulated).toBe(true);
    void draft;
  });
});

describe("ownership guard via ApiError shape", () => {
  it("surfaces not_found through the shared error type", () => {
    const d = freshDb("merchants-guard");
    expect(() => resolveMerchant(d, "merchants-guard", "mrc_totally_foreign")).toThrow(MerchantNotFoundError);
    // MerchantNotFoundError maps to not_found in the route layer.
    const err = new MerchantNotFoundError();
    expect(err.message).toContain("Merchant not found");
    expect(new ApiError("not_found", err.message).status).toBeDefined();
  });
});
