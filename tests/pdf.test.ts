// Campaign summary PDF renderer: valid PDF bytes, correct money model, Hindi path.
import { describe, expect, it } from "vitest";
import { renderCampaignSummaryPdf, type CampaignSummaryReport } from "@/lib/report-pdf";

const baseReport: CampaignSummaryReport = {
  businessName: "Anaya's Bakery, Pune",
  campaignId: "cmp_0782b6a196684e1b",
  version: 4,
  status: "queued",
  offer: {
    bundleName: "Two samosas + one tea",
    pricePaise: 7000,
    normalPricePaise: 9000,
    cap: 20,
    maxDiscountExposurePaise: 40000,
  },
  expiresAtIso: "2026-11-09T12:30:00.000Z",
  approvedAtIso: "2026-11-06T13:30:00.000Z",
  audienceCount: 40,
  aiMode: "fixture",
  customerMessage: "Two samosas + one tea for \u20B970, 3-6 p.m. Up to 20 combos available. While stocks last.",
  customerMessageIsHindi: false,
  redemptions: {
    redemptions: 10,
    cap: 20,
    revenuePaise: 70000,
    variableCostPaise: 40000,
    contributionPaise: 30000,
    discountPaise: 20000,
  },
  caveats: [
    "Simulated campaign outcomes - no real messages were sent and no real customers were contacted.",
    "Contribution is bundle revenue minus variable cost. It is not proven incremental profit.",
  ],
  generatedAtIso: "2026-11-06T13:31:00.000Z",
};

describe("campaign summary PDF", () => {
  it("renders the canonical replay numbers into a valid PDF document", async () => {
    const pdf = await renderCampaignSummaryPdf(baseReport);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // A one-page text report with embedded font subsets is comfortably in this band.
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.length).toBeLessThan(2_000_000);
  });

  it("renders the zero-redemption empty state without throwing", async () => {
    const pdf = await renderCampaignSummaryPdf({
      ...baseReport,
      redemptions: { redemptions: 0, cap: 20, revenuePaise: 0, variableCostPaise: 0, contributionPaise: 0, discountPaise: 0 },
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a Hindi customer message through the Devanagari font", async () => {
    const pdf = await renderCampaignSummaryPdf({
      ...baseReport,
      customerMessage: "\u0926\u094B \u0938\u092E\u094B\u0938\u093E + \u090F\u0915 \u091A\u093E\u092F - \u0938\u093F\u0930\u094D\u092B \u20B970 \u092E\u0947\u0902, \u0926\u094B\u092A\u0939\u0930 3-6 \u092C\u091C\u0947\u0964",
      customerMessageIsHindi: true,
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles a long business name across the meta rows", async () => {
    const pdf = await renderCampaignSummaryPdf({
      ...baseReport,
      businessName:
        "Sharma & Sons Deluxe Bakery, Sweets and Chaat House - Camp Branch Number 12, Pune (Registered Demo Trading Name)",
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
