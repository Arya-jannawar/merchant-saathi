import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { redeemEvent } from "@/services/campaigns";
import { resolveTenant } from "@/services/demo";
import { redeemRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/demo/campaigns/{id}/redeem - apply one fixed fixture redemption event (idempotent per event). */
export const POST = routeHandler(async (request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(redeemRequestSchema, await request.json());
  const result = redeemEvent(db, merchantId, fixture, ctx.params.id, body.eventId);
  return ok(result, 201);
});
