import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { getCampaignResults } from "@/services/campaigns";
import { renderCampaignSummaryPdf } from "@/lib/report-pdf";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/{id}/summary-pdf - download the campaign summary as a PDF.
 * Same authorized report model as the results endpoint and the TXT download;
 * a campaign from another session is a clean 404.
 */
export const GET = routeHandler(async (_request: Request, ctx: { params: { id: string } }) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = await resolveTenant(db, sessionId, getRequestedMerchantId(_request));
  const results = await getCampaignResults(db, merchantId, fixture, ctx.params.id);

  const pdf = await renderCampaignSummaryPdf({
    businessName: results.merchantName,
    campaignId: results.campaign.id,
    version: results.campaign.version,
    status: results.campaign.status,
    offer: {
      bundleName: results.campaign.offer.bundleName,
      pricePaise: results.campaign.offer.pricePaise,
      normalPricePaise: results.campaign.offer.normalPricePaise,
      cap: results.campaign.offer.cap,
      maxDiscountExposurePaise: results.campaign.offer.maxDiscountExposurePaise,
    },
    expiresAtIso: results.campaign.expiresAt,
    approvedAtIso: results.campaign.approvedAt,
    audienceCount: results.campaign.audienceCount,
    aiMode: results.campaign.aiMode,
    customerMessage: results.campaign.copy.body,
    // Devanagari block presence decides the font for that run - the stored copy
    // may be English, Hindi, or owner-edited text in either script.
    customerMessageIsHindi: /[\u0900-\u097F]/.test(results.campaign.copy.body),
    redemptions: {
      redemptions: results.redemptions.redemptions,
      cap: results.redemptions.cap,
      revenuePaise: results.redemptions.revenuePaise,
      variableCostPaise: results.redemptions.variableCostPaise,
      contributionPaise: results.redemptions.contributionPaise,
      discountPaise: results.redemptions.discountPaise,
    },
    caveats: results.caveats,
    generatedAtIso: getNow().toISOString(),
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="campaign-${results.campaign.id}-v${results.campaign.version}-summary.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
