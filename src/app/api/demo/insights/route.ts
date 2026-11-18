import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant, getDemoInsights } from "@/services/demo";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** GET /api/demo/insights - per-day afternoon totals + campaign funnel for the active business. */
export const GET = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const insights = await getDemoInsights(db, merchantId, getNow(), fixture);
  return ok(insights);
});
