import { z } from "zod";
import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { createDeposit, listDeposits } from "@/services/deposits";

export const dynamic = "force-dynamic";

const DepositSchema = z.object({
  orderRef: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(200),
  orderPaise: z.number().int().positive(),
  depositPct: z.number().int().positive().max(100),
});

/** GET /api/planning/deposits - deposit requests + reconciliation status. */
export const GET = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  return ok({ deposits: listDeposits(db, merchantId) });
});

/** POST /api/planning/deposits - create a labeled payment-link deposit request. */
export const POST = routeHandler(async (request: Request) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const body = parseBody(DepositSchema, await request.json());
  return ok(createDeposit(db, merchantId, body), 201);
});
