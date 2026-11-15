import { routeHandler, ok } from "@/lib/http";
import { SERVICE_CATALOGUE } from "@/lib/services-catalogue";

export const dynamic = "force-static";

/** GET /api/planning/services - the verified business services directory. */
export const GET = routeHandler(async () => {
  return ok({ services: SERVICE_CATALOGUE });
});
