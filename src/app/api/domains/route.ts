import { routeHandler, ok } from "@/lib/http";
import { DOMAIN_REGISTRY } from "@/lib/fixture";

export const dynamic = "force-dynamic";

/** GET /api/domains - the business domains a merchant can register under. */
export const GET = routeHandler(async () => {
  return ok({
    domains: DOMAIN_REGISTRY.map((entry) => ({
      id: entry.domain.id,
      label: entry.domain.label,
      emoji: entry.domain.emoji,
      pitch: entry.domain.pitch,
      bundleName: entry.bundleName,
      fixtureVersion: entry.fixtureVersion,
    })),
  });
});
