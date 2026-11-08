import type { SqliteDatabase } from "@/lib/db";
import { openDatabase } from "@/lib/db";
import { resetTenant } from "@/lib/seed";
import { loadFixture, type Fixture } from "@/lib/fixture";
import {
  draftCampaign,
  approveCampaign,
  executeCampaign,
  type DraftResult,
} from "@/services/campaigns";

export function openTestDb(): SqliteDatabase {
  return openDatabase(process.env.DATABASE_PATH ?? "./data/test.sqlite");
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
  const merchantId = resetTenant(db, sessionName);
  const fixture = loadFixture();
  const draft = await draftCampaign(db, merchantId, fixture, {
    opportunityId: "afternoon-decline-v1",
    pricePaise: opts?.pricePaise ?? fixture.bundle.proposedPricePaise,
    cap: opts?.cap ?? fixture.bundle.cap,
    locale: "en",
  });
  approveCampaign(db, merchantId, fixture, draft.campaignId, draft.version, draft.previewHash);
  return { merchantId, fixture, draft };
}
