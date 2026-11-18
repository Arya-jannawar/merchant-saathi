import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { revertBatch } from "@/services/imports";

export const dynamic = "force-dynamic";

/** POST /api/planning/imports/{id}/revert - reverse a confirmed batch with an audit trail. */
export const POST = routeHandler(async (_request: Request, ctx: { params: { id: string } }) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = await resolveTenant(db, sessionId, getRequestedMerchantId(_request));
  return ok(await revertBatch(db, merchantId, ctx.params.id));
});
