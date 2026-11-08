import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok } from "@/lib/http";
import { resetDemo } from "@/services/demo";

export const dynamic = "force-dynamic";

/** POST /api/demo/reset - resets only THIS demo session's tenant and reseeds it. */
export const POST = routeHandler(async () => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const result = resetDemo(db, sessionId);
  return ok({ fixtureVersion: result.fixtureVersion, merchantName: result.merchantName, reset: true });
});

export const GET = routeHandler(async () => {
  return NextResponse.json(
    { error: { code: "invalid_input", message: "Use POST to reset the demo." } },
    { status: 405 }
  );
});
