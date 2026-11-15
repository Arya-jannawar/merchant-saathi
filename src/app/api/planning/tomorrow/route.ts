import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { tomorrowForecast } from "@/services/planning";

export const dynamic = "force-dynamic";

/** GET /api/planning/tomorrow - next-day forecast with the selection backtest. */
export const GET = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  return ok(tomorrowForecast(db, merchantId));
});
