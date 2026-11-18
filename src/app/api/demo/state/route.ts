import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { getDemoState } from "@/services/demo";

export const dynamic = "force-dynamic";

/** GET /api/demo/state - dashboard bootstrap. Reports seeded/unseeded without side effects. */
export const GET = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const state = await getDemoState(db, sessionId, getRequestedMerchantId(request));
  return ok(state);
});
