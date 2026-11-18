import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { getOpportunities } from "@/domain/metrics";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** GET /api/opportunities - evidence-backed opportunities for this session's tenant. */
export const GET = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const result = await getOpportunities(db, merchantId, fixture, getNow());
  return ok(result);
});
