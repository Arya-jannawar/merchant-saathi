import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { approveCampaign } from "@/services/campaigns";
import { loadFixture } from "@/lib/fixture";
import { resolveTenant } from "@/services/demo";
import { approveRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/campaigns/{id}/approve - approve the exact previewed version. */
export const POST = routeHandler(async (request: Request, ctx: { params: { id: string } }) => {
  const db = getDb();
  const sessionId = getDemoSessionId();
  const merchantId = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const fixture = loadFixture();
  const body = parseBody(approveRequestSchema, await request.json());
  const result = approveCampaign(db, merchantId, fixture, ctx.params.id, body.version, body.previewHash);
  return ok(result, 201);
});
