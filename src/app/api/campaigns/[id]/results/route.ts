import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { getCampaignResults } from "@/services/campaigns";
import { resolveTenant } from "@/services/demo";

export const dynamic = "force-dynamic";

/** GET /api/campaigns/{id}/results - activity, simulated redemptions and totals. */
export const GET = routeHandler(async (request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const results = getCampaignResults(db, merchantId, fixture, ctx.params.id);
  return ok(results);
});
