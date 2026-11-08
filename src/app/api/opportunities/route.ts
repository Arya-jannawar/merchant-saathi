import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { ensureTenant } from "@/services/demo";
import { getOpportunities } from "@/domain/metrics";
import { loadFixture } from "@/lib/fixture";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** GET /api/opportunities - evidence-backed opportunities for this session's tenant. */
export const GET = routeHandler(async () => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const merchantId = ensureTenant(db, sessionId);
  const fixture = loadFixture();
  const result = getOpportunities(db, merchantId, fixture, getNow());
  return ok(result);
});
