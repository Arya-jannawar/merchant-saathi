import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { getOperationsInsights } from "@/domain/operations";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** GET /api/operations - the operations copilot: run-rates, cover, restock plan. */
export const GET = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const insights = getOperationsInsights(db, merchantId, fixture, getNow());
  return ok(insights);
});
