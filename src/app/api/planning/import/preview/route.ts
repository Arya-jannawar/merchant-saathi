import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { previewImport } from "@/services/imports";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAX_CONTENT_BYTES = 2_000_000;

const PreviewSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  dateOrder: z.enum(["auto", "dmy", "mdy", "ymd"]).default("auto"),
});

/** POST /api/planning/import/preview - parse and map, no ledger writes. */
export const POST = routeHandler(async (request: Request) => {
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(PreviewSchema, await request.json());
  return ok(await previewImport(db, merchantId, body.filename, body.content, body.dateOrder));
});
