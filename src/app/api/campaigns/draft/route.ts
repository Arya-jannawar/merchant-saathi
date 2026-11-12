import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { draftCampaign } from "@/services/campaigns";
import { draftRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/campaigns/draft - create a (new) draft version with computed constraints + AI copy. */
export const POST = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(draftRequestSchema, await request.json());
  const result = await draftCampaign(db, merchantId, fixture, {
    campaignId: body.campaignId,
    opportunityId: body.opportunityId,
    pricePaise: body.offer.pricePaise,
    cap: body.offer.cap,
    locale: body.locale,
    copyOverride: body.copyOverride,
  });
  return ok(result, 201);
});
