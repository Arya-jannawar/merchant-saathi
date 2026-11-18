import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { collectDeposit } from "@/services/deposits";

export const dynamic = "force-dynamic";

/** POST /api/planning/deposits/{id}/collect - simulated success callback; idempotent. */
export const POST = routeHandler(async (_request: Request, ctx: { params: { id: string } }) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = await resolveTenant(db, sessionId, getRequestedMerchantId(_request));
  const result = await collectDeposit(db, merchantId, ctx.params.id);
  return ok(result, 201);
});
