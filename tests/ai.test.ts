import { describe, expect, it } from "vitest";
import {
  actionPlanGrounded,
  copyMonetaryTermsValid,
  parseLiveContent,
  fixtureDraft,
  templateCopy,
  type AiActionPlanItem,
  type AiDraftContext,
} from "@/adapters/ai";
import { computeSuggestedPrice } from "@/services/campaigns";

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
  corrections: { suggestedPricePaise: null, suggestedCap: null },
  audience: { eligibleCount: 40, excludedCount: 10, channel: "sms" },
  locale: "en",
};

const ALLOWED = ["afternoon-order-delta-v1", "afternoon-net-sales-v1", "afternoon-aov-v1", "bundle-margin-v1", "bundle-capacity-v1", "audience-consent-v1"];

const passingPlan: AiActionPlanItem[] = [
  { text: "Offer Two samosas + one tea at \u20B970 (usual \u20B990)." },
  { text: "Cap redemptions at 20 bundles per day." },
  { text: "Review the 40 opted-in recipients, then approve this exact version." },
];

function liveBody(plan: AiActionPlanItem[]): Record<string, unknown> {
  return {
    headline: "Try a capped afternoon bundle",
    explanation: "Orders fell 30% while AOV held steady, so a capped bundle is a low-risk test.",
    actionPlan: plan,
    evidenceIds: ["bundle-margin-v1"],
    assumptions: ["Demand is not guaranteed"],
    copy: { title: "Combo", body: "Two samosas and a tea for \u20B970, 3-6 p.m. Up to 20 combos available." },
    locale: "en",
  };
}

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

  it("fixture action plan for a passing offer lists three grounded steps", () => {
    const draft = fixtureDraft(ctx, ALLOWED);
    expect(draft.actionPlan).toHaveLength(3);
    expect(draft.actionPlan.every((item) => item.action === undefined)).toBe(true);
    expect(draft.actionPlan[0].text).toContain("\u20B970");
    expect(draft.actionPlan[2].text).toContain("40");
    expect(actionPlanGrounded(draft.actionPlan, ctx)).toBe(true);
  });

  it("fixture action plan for a rejected price carries the suggested price action", () => {
    const failing: AiDraftContext = {
      ...ctx,
      offer: { ...ctx.offer, pricePaise: 5000, contributionPaise: 1000, marginPct: 20 },
      corrections: { suggestedPricePaise: 5400, suggestedCap: null },
    };
    const draft = fixtureDraft(failing, ALLOWED);
    expect(draft.actionPlan[0].action).toEqual({ kind: "set-price", valuePaise: 5400 });
    expect(draft.actionPlan[0].text).toContain("\u20B954");
    expect(actionPlanGrounded(draft.actionPlan, failing)).toBe(true);
  });

  it("action plan guard rejects invented rupee amounts", () => {
    const plan: AiActionPlanItem[] = [{ text: "Promote a \u20B999 flash deal today." }, { text: "Cap redemptions at 20 bundles per day." }];
    expect(actionPlanGrounded(plan, ctx)).toBe(false);
  });

  it("action plan guard rejects correction actions that do not match the computed suggestion", () => {
    const plan: AiActionPlanItem[] = [
      { text: "Set the price to \u20B954 to clear the floor.", action: { kind: "set-price", valuePaise: 6000 } },
      { text: "Update the draft and re-check the math." },
    ];
    const failing: AiDraftContext = {
      ...ctx,
      offer: { ...ctx.offer, pricePaise: 5000, marginPct: 20 },
      corrections: { suggestedPricePaise: 5400, suggestedCap: null },
    };
    expect(actionPlanGrounded(plan, failing)).toBe(false);
    expect(actionPlanGrounded([{ ...plan[0], action: { kind: "set-price", valuePaise: 5400 } }, plan[1]], failing)).toBe(true);
  });

  it("computeSuggestedPrice rounds up to the nearest rupee clearing the floor", () => {
    expect(computeSuggestedPrice({ ...ctx.offer, pricePaise: 5000, marginPct: 20, passes: false } as never)).toBe(5400);
    expect(computeSuggestedPrice({ ...ctx.offer, pricePaise: 7000, marginPct: 42.857, passes: true } as never)).toBeNull();
    expect(
      computeSuggestedPrice({ ...ctx.offer, pricePaise: 5000, bundleCostPaise: null, marginPct: null, passes: false } as never)
    ).toBeNull();
  });

  it("rejects live responses with unknown evidence ids", () => {
    const body = { ...liveBody(passingPlan), evidenceIds: ["made-up-metric-id"] };
    expect(() => parseLiveContent(JSON.stringify(body), ctx, ALLOWED)).toThrowError(/unknown evidence/i);
  });

  it("rejects live responses with contradictory monetary terms", () => {
    const body = {
      ...liveBody(passingPlan),
      copy: { title: "Combo", body: "Everything for \u20B990 today! Up to 20 combos." },
    };
    expect(() => parseLiveContent(JSON.stringify(body), ctx, ALLOWED)).toThrowError(/monetary terms/i);
  });

  it("accepts a grounded live action plan and rejects an ungrounded one", () => {
    const accepted = parseLiveContent(JSON.stringify(liveBody(passingPlan)), ctx, ALLOWED);
    expect(accepted.actionPlan).toHaveLength(3);
    const invented = liveBody([{ ...passingPlan[0], text: "Flash price \u20B999 for one day only." }, passingPlan[1], passingPlan[2]]);
    expect(() => parseLiveContent(JSON.stringify(invented), ctx, ALLOWED)).toThrowError(/action plan/i);
  });

  it("rejects live responses with an out-of-range action plan", () => {
    const body = liveBody([{ text: "Only one step and it is short." }]);
    expect(() => parseLiveContent(JSON.stringify(body), ctx, ALLOWED)).toThrowError();
  });

  it("rejects non-JSON live responses", () => {
    expect(() => parseLiveContent("Sorry, I cannot help with that.", ctx, ALLOWED)).toThrowError(/valid JSON/i);
  });

  it("rejects live responses missing required fields", () => {
    const content = JSON.stringify({ headline: "Too short" });
    expect(() => parseLiveContent(content, ctx, ALLOWED)).toThrowError();
  });
});
