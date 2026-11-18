import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { yearReport } from "@/services/planning";
import { getNow } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** GET /api/planning/year?scope=calendar|financial&year=YYYY */
export const GET = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "financial" ? "financial" : "calendar";
  const yearRaw = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  const istYear = Number.parseInt(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(getNow()), 10);
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : istYear;
  return ok(await yearReport(db, merchantId, scope, year));
});
