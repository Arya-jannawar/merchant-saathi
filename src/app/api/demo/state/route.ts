import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { getDemoState } from "@/services/demo";

export const dynamic = "force-dynamic";

/** GET /api/demo/state - dashboard bootstrap. Reports seeded/unseeded without side effects. */
export const GET = routeHandler(async () => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const state = getDemoState(db, sessionId);
  return ok(state);
});
