import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { listBatches, revertBatch } from "@/services/imports";

export const dynamic = "force-dynamic";

/** GET /api/planning/imports - the last 20 import batches with statuses. */
export const GET = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  return ok({ batches: await listBatches(db, merchantId) });
});
