import type { SqliteDatabase } from "@/lib/db";
import { getDb } from "@/lib/db";
import { resetTenant } from "@/lib/seed";
import { loadFixture, type Fixture } from "@/lib/fixture";
import {
  draftCampaign,
  approveCampaign,
  executeCampaign,
  type DraftResult,
} from "@/services/campaigns";

/**
 * Every suite shares the hosted Postgres database; tenants are isolated by
 * their session-scoped merchant ids, so no truncation is needed between files.
 */
export async function openTestDb(): Promise<SqliteDatabase> {
  return getDb();
}

export interface TestCampaign {
  merchantId: string;
  fixture: Fixture;
  draft: DraftResult;
}

export async function freshApprovedCampaign(
  db: SqliteDatabase,
  sessionName: string,
  opts?: { pricePaise?: number; cap?: number }
): Promise<TestCampaign> {
  const merchantId = await resetTenant(db, sessionName);
  const fixture = loadFixture();
  const draft = await draftCampaign(db, merchantId, fixture, {
    opportunityId: "afternoon-decline-v1",
    pricePaise: opts?.pricePaise ?? fixture.bundle.proposedPricePaise,
    cap: opts?.cap ?? fixture.bundle.cap,
    locale: "en",
  });
  await approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
  return { merchantId, fixture, draft };
}
