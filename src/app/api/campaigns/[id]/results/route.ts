import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { getCampaignResults } from "@/services/campaigns";
import { loadFixture } from "@/lib/fixture";
import { ensureTenant } from "@/services/demo";

export const dynamic = "force-dynamic";

/** GET /api/campaigns/{id}/results - activity, simulated redemptions and totals. */
export const GET = routeHandler(async (_request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const merchantId = ensureTenant(db, sessionId);
  const fixture = loadFixture();
  const results = getCampaignResults(db, merchantId, fixture, ctx.params.id);
  return ok(results);
});
