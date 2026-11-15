import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { confirmImport } from "@/services/imports";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ConfirmSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(2_000_000),
  dateOrder: z.enum(["auto", "dmy", "mdy", "ymd"]).default("auto"),
});

/** POST /api/planning/import/confirm - atomic post of every valid row + receipt. */
export const POST = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(ConfirmSchema, await request.json());
  return ok(confirmImport(db, merchantId, body.filename, body.content, body.dateOrder), 201);
});
