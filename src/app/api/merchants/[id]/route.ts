import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { removeMerchant } from "@/services/demo";

export const dynamic = "force-dynamic";

/** DELETE /api/merchants/{id} - remove an owned business and all of its rows. */
export const DELETE = routeHandler(async (_request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  removeMerchant(db, sessionId, ctx.params.id);
  return ok({ removed: ctx.params.id });
});
