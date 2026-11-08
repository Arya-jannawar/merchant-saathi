import { describe, expect, it } from "vitest";
import { copyMonetaryTermsValid, parseLiveContent, fixtureDraft, templateCopy, type AiDraftContext } from "@/adapters/ai";

const ctx: AiDraftContext = {
  observation: "Orders fell from 100 to 70 (-30%).",
  metricSummaries: [{ id: "bundle-margin-v1", label: "margin", valueLabel: "42.9%" }],
  offer: {
    bundleName: "Two samosas + one tea",
    pricePaise: 7000,
    normalPricePaise: 9000,
    bundleCostPaise: 4000,
    contributionPaise: 3000,
    marginPct: 42.857,
    floorPct: 25,
    cap: 20,
    capacity: 25,
    maxDiscountExposurePaise: 40000,
    discountPct: 22.222,
  },
  locale: "en",
};

const ALLOWED = ["afternoon-order-delta-v1", "afternoon-net-sales-v1", "afternoon-aov-v1", "bundle-margin-v1", "bundle-capacity-v1", "audience-consent-v1"];

describe("AI guardrails", () => {
  it("accepts copy that only mentions the computed price and cap", () => {
    expect(copyMonetaryTermsValid({ title: "Combo", body: "Two samosas and a tea for \u20B970, 3-6 p.m. Up to 20 combos available." }, 7000, 20)).toBe(true);
  });

  it("rejects copy that mentions a different rupee amount", () => {
    expect(copyMonetaryTermsValid({ title: "Combo", body: "Two samosas and a tea for \u20B950, 3-6 p.m. Up to 20 combos available." }, 7000, 20)).toBe(false);
    expect(copyMonetaryTermsValid({ title: "Was \u20B990!", body: "Now \u20B970. Up to 20 combos." }, 7000, 20)).toBe(false);
  });

  it("rejects copy missing the cap", () => {
    expect(copyMonetaryTermsValid({ title: "Combo", body: "Two samosas and a tea for \u20B970, 3-6 p.m." }, 7000, 20)).toBe(false);
  });

  it("template copy always passes its own monetary check", () => {
    const copy = templateCopy(ctx);
    expect(copyMonetaryTermsValid(copy, ctx.offer.pricePaise, ctx.offer.cap)).toBe(true);
  });

  it("fixture draft only references allowlisted evidence ids", () => {
    const draft = fixtureDraft(ctx, ALLOWED);
    expect(draft.evidenceIds.every((id) => ALLOWED.includes(id))).toBe(true);
    expect(draft.copy.body).toContain("\u20B970");
    expect(draft.copy.body).toContain("20");
  });

  it("rejects live responses with unknown evidence ids", () => {
    const content = JSON.stringify({
      headline: "Try a capped afternoon bundle",
      explanation: "Orders fell 30% while AOV held steady, so a capped bundle is a low-risk test.",
      evidenceIds: ["made-up-metric-id"],
      assumptions: ["Demand is not guaranteed"],
      copy: { title: "Afternoon combo", body: "Two samosas and a tea for \u20B970, 3-6 p.m. Up to 20 combos available." },
      locale: "en",
    });
    expect(() => parseLiveContent(content, ctx, ALLOWED)).toThrowError(/unknown evidence/i);
  });

  it("rejects live responses with contradictory monetary terms", () => {
    const content = JSON.stringify({
      headline: "Try a capped afternoon bundle",
      explanation: "Orders fell 30% while AOV held steady, so a capped bundle is a low-risk test.",
      evidenceIds: ["bundle-margin-v1"],
      assumptions: [],
      copy: { title: "Combo", body: "Everything for \u20B990 today! Up to 20 combos." },
      locale: "en",
    });
    expect(() => parseLiveContent(content, ctx, ALLOWED)).toThrowError(/monetary terms/i);
  });

  it("rejects non-JSON live responses", () => {
    expect(() => parseLiveContent("Sorry, I cannot help with that.", ctx, ALLOWED)).toThrowError(/valid JSON/i);
  });

  it("rejects live responses missing required fields", () => {
    const content = JSON.stringify({ headline: "Too short" });
    expect(() => parseLiveContent(content, ctx, ALLOWED)).toThrowError();
  });
});
