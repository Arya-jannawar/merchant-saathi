import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resetActiveMerchant } from "@/services/demo";
import { resetRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/demo/reset - resets only THIS demo session's tenant and reseeds it. */
export const POST = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  // Body is optional; an empty body resets to the standard bakery-v1 fixture.
  const raw = await request.json().catch(() => ({}));
  const body = parseBody(resetRequestSchema, raw ?? {});
    // An explicit fixture switches the story (standard/thin demo); without one the
  // merchant keeps its own registered domain.
  const result = resetActiveMerchant(db, sessionId, getRequestedMerchantId(request), body.fixtureVersion);
  return ok({ fixtureVersion: result.fixtureVersion, merchantName: result.merchantName, reset: true });
});

export const GET = routeHandler(async () => {
  return NextResponse.json(
    { error: { code: "invalid_input", message: "Use POST to reset the demo." } },
    { status: 405 }
  );
});
