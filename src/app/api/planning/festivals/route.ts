import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { festivalPlan } from "@/services/festivals";

export const dynamic = "force-dynamic";

/** GET /api/planning/festivals?prepDays=1&objective=profit */
export const GET = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const url = new URL(request.url);
  const prepDays = Math.max(Number.parseInt(url.searchParams.get("prepDays") ?? "1", 10) || 1, 0);
  const objective = url.searchParams.get("objective") === "trials" ? "trials" : "profit";
  return ok(festivalPlan(db, merchantId, { prepDays, objective, budgetPaise: null }));
});
