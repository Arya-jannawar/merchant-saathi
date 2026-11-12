import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { executeCampaign } from "@/services/campaigns";
import { resolveTenant } from "@/services/demo";
import { executeRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/campaigns/{id}/execute - transactionally queue the simulated outbox (idempotent). */
export const POST = routeHandler(async (request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(executeRequestSchema, await request.json());
  const receipt = executeCampaign(db, merchantId, fixture, ctx.params.id, body.version, body.idempotencyKey);
  return ok(receipt, 201);
});
