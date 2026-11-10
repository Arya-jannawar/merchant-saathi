import { z } from "zod";
import { getDb } from "@/lib/db";
import { getDemoSessionId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { createMerchant, listMerchants } from "@/services/demo";

export const dynamic = "force-dynamic";

const CreateMerchantSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
});

/** GET /api/merchants - the businesses owned by this demo session. */
export const GET = routeHandler(async () => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  return ok({ merchants: listMerchants(db, sessionId) });
});

/** POST /api/merchants - add a business (seeded deterministically, capped per session). */
export const POST = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const body = parseBody(CreateMerchantSchema, await request.json().catch(() => null));
  const merchant = createMerchant(db, sessionId, body.name);
  return ok(merchant, 201);
});
