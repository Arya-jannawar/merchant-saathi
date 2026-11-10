import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@/lib/db";
import { withTransaction } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getNow, istParts, istToUtcIso } from "@/lib/clock";
import type { Fixture } from "@/lib/fixture";
import { computeOffer, type OfferComputation } from "@/domain/offers";
import { getAudience } from "@/domain/consent";
import { getOpportunities, type EvidenceEntry } from "@/domain/metrics";
import { generateDraft } from "@/adapters/ai";

/**
 * Campaign lifecycle: draft -> approve -> queue (simulated) -> redeem (simulated) -> results.
 *
 * Invariants enforced here (and tested):
 * - Money arithmetic happens in code, never in the model.
 * - Approval binds an exact version + payload hash; any later change forces a fresh preview.
 * - Execution rechecks stock version, consent register and expiry; never executes stale state.
 * - Duplicate execute / duplicate redemption events have no double effect (idempotency).
 * - The redemption cap is enforced atomically.
 */

export const EVIDENCE_IDS = [
  "afternoon-order-delta-v1",
  "afternoon-net-sales-v1",
  "afternoon-aov-v1",
  "bundle-margin-v1",
  "bundle-capacity-v1",
  "audience-consent-v1",
] as const;

export interface StoredOffer {
  bundleId: string;
  bundleName: string;
  components: { skuId: string; quantity: number }[];
  pricePaise: number;
  normalPricePaise: number;
  bundleCostPaise: number | null;
  cap: number;
  discountPaise: number;
  discountPct: number;
  maxDiscountExposurePaise: number;
}

export interface StoredCopy {
  title: string;
  body: string;
}

export interface CampaignRow {
  id: string;
  merchant_id: string;
  version: number;
  status: "draft" | "approved" | "queued";
  opportunity_id: string;
  offer_json: string;
  copy_json: string;
  audience_hash: string;
  audience_count: number;
  inventory_version: number;
  metric_snapshot_id: string;
  preview_hash: string;
  expires_at: string;
  ai_mode: string;
  created_at: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function audit(
  db: SqliteDatabase,
  merchantId: string,
  actorId: string,
  action: string,
  entityId: string,
  details: Record<string, unknown> = {}
): void {
  db.prepare(
    "INSERT INTO audit_events (merchant_id, actor_id, action, entity_id, timestamp, redacted_details_json) VALUES (?,?,?,?,?,?)"
  ).run(merchantId, actorId, action, entityId, getNow().toISOString(), JSON.stringify(details));
}

function currentInventoryVersion(db: SqliteDatabase, merchantId: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM inventory WHERE merchant_id = ?").get(merchantId) as {
    v: number;
  };
  return row.v;
}

/** End of the NEXT weekday (Mon-Fri) at 18:00 IST, strictly after `now`. */
export function nextWeekdayEveningIso(now: Date): string {
  const p = istParts(now);
  for (let add = 1; add <= 7; add++) {
    const weekday = (p.weekday + add) % 7;
    if (weekday >= 1 && weekday <= 5) {
      return istToUtcIso(p.year, p.month, p.day + add, 18, 0);
    }
  }
  throw new Error("unreachable");
}

function getCampaignRow(db: SqliteDatabase, merchantId: string, campaignId: string, version: number): CampaignRow {
  const row = db
    .prepare("SELECT * FROM campaigns WHERE merchant_id = ? AND id = ? AND version = ?")
    .get(merchantId, campaignId, version) as CampaignRow | undefined;
  if (!row) throw new ApiError("not_found", "Campaign version not found for this session.");
  return row;
}

function latestVersion(db: SqliteDatabase, merchantId: string, campaignId: string): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM campaigns WHERE merchant_id = ? AND id = ?").get(merchantId, campaignId) as {
    v: number | null;
  };
  return row.v ?? 0;
}

// ---------------------------------------------------------------- draft

export interface DraftInput {
  campaignId?: string;
  opportunityId: string;
  pricePaise: number;
  cap: number;
  locale: "en" | "hi";
  copyOverride?: { title: string; body: string };
}

export interface DraftResult {
  campaignId: string;
  version: number;
  status: "draft";
  offer: StoredOffer;
  computed: OfferComputation;
  headline: string;
  explanation: string;
  assumptions: string[];
  copy: StoredCopy;
  copyLocale: "en" | "hi";
  copySource: "model" | "template";
  aiMode: "live" | "fixture" | "fallback";
  aiNote: string | null;
  evidence: EvidenceEntry[];
  evidenceIds: string[];
  audience: { eligibleCount: number; excludedCount: number; channel: string };
  expiresAt: string;
  validityLabel: string;
  previewHash: string;
}

export async function draftCampaign(db: SqliteDatabase, merchantId: string, fixture: Fixture, input: DraftInput): Promise<DraftResult> {
  const now = getNow();
  // Evidence is read once and doubles as the reference check: the offer must
  // price an opportunity the evidence engine currently offers. A made-up id is
  // a bad reference; no qualifying opportunity at all (thin data) means there
  // is nothing to price yet.
  const ops = getOpportunities(db, merchantId, fixture, now);
  if (ops.items.length === 0) {
    throw new ApiError(
      "business_rule",
      ops.lowDataReason ?? "Insufficient evidence for the current windows - there is no opportunity to draft an offer for."
    );
  }
  if (!ops.items.some((item) => item.id === input.opportunityId)) {
    throw new ApiError("invalid_input", "Unknown opportunity id for the current evidence.", {
      fieldErrors: { opportunityId: "Must be an opportunity the evidence engine currently reports." },
    });
  }
  const computed = computeOffer(db, merchantId, fixture, input.pricePaise, input.cap);
  const audience = getAudience(db, merchantId, fixture.customers.channel);
  const invVersion = currentInventoryVersion(db, merchantId);
  const expiresAt = nextWeekdayEveningIso(now);

  const offer: StoredOffer = {
    bundleId: fixture.bundle.id,
    bundleName: fixture.bundle.name,
    components: fixture.bundle.components,
    pricePaise: input.pricePaise,
    normalPricePaise: fixture.bundle.normalPricePaise,
    bundleCostPaise: computed.bundleCostPaise,
    cap: input.cap,
    discountPaise: computed.discountPaise,
    discountPct: computed.discountPct,
    maxDiscountExposurePaise: computed.maxDiscountExposurePaise,
  };

  // Verified metric summaries for the AI (no customer identifiers, no raw rows).
  const evidence = ops.items[0]?.evidence ?? [];
  const metricSummaries = evidence.map((e) => ({ id: e.id, label: e.label, valueLabel: e.valueLabel }));
  const observation =
    ops.items[0]?.observation ??
    ops.lowDataReason ??
    "Afternoon sales comparison for the last two complete Mon-Fri windows.";

  const ai = await generateDraft(
    {
      observation,
      metricSummaries,
      offer: {
        bundleName: offer.bundleName,
        pricePaise: offer.pricePaise,
        normalPricePaise: offer.normalPricePaise,
        bundleCostPaise: computed.bundleCostPaise,
        contributionPaise: computed.contributionPaise,
        marginPct: computed.marginPct,
        floorPct: computed.floorPct,
        cap: offer.cap,
        capacity: computed.capacity,
        maxDiscountExposurePaise: offer.maxDiscountExposurePaise,
        discountPct: offer.discountPct,
      },
      locale: input.locale,
    },
    [...EVIDENCE_IDS]
  );

  const copy: StoredCopy = input.copyOverride ?? ai.draft.copy;
  const evidenceIds = ai.draft.evidenceIds.filter((id) => (EVIDENCE_IDS as readonly string[]).includes(id));

  // A client-supplied campaign id must already belong to THIS tenant. Inserting
  // a foreign id would collide with the other tenant's (id, version) primary key
  // and surface as an internal error; not_found also avoids leaking that the id
  // exists elsewhere.
  let campaignId: string;
  if (input.campaignId) {
    const known = db
      .prepare("SELECT id FROM campaigns WHERE merchant_id = ? AND id = ? LIMIT 1")
      .get(merchantId, input.campaignId);
    if (!known) throw new ApiError("not_found", "Campaign id does not exist for this session.");
    campaignId = input.campaignId;
  } else {
    campaignId = `cmp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  const version = latestVersion(db, merchantId, campaignId) + 1;

  const previewHash = sha256(
    JSON.stringify({
      campaignId,
      version,
      pricePaise: offer.pricePaise,
      cap: offer.cap,
      audienceHash: audience.hash,
      inventoryVersion: invVersion,
      expiresAt,
    })
  );

  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO campaigns (id, merchant_id, version, status, opportunity_id, offer_json, copy_json, audience_hash,
        audience_count, inventory_version, metric_snapshot_id, preview_hash, expires_at, ai_mode, created_at)
       VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      campaignId,
      merchantId,
      version,
      input.opportunityId,
      JSON.stringify(offer),
      JSON.stringify(copy),
      audience.hash,
      audience.eligibleIds.length,
      invVersion,
      "afternoon-decline-v1",
      previewHash,
      expiresAt,
      ai.reportedMode,
      now.toISOString()
    );
    audit(db, merchantId, "owner-demo", "campaign.drafted", `${campaignId}:${version}`, {
      pricePaise: offer.pricePaise,
      cap: offer.cap,
      passes: computed.passes,
    });
  });

  const validityLabel = "next weekday afternoon, 3-6 p.m.";
  return {
    campaignId,
    version,
    status: "draft",
    offer,
    computed,
    headline: ai.draft.headline,
    explanation: ai.draft.explanation,
    assumptions: ai.draft.assumptions,
    copy,
    copyLocale: input.locale,
    copySource: ai.copySource,
    aiMode: ai.reportedMode,
    aiNote: ai.note,
    evidence,
    evidenceIds,
    audience: {
      eligibleCount: audience.eligibleIds.length,
      excludedCount: audience.excluded.length,
      channel: fixture.customers.channel,
    },
    expiresAt,
    validityLabel,
    previewHash,
  };
}

// ---------------------------------------------------------------- approve

export interface ApproveResult {
  approvalId: string;
  approvedVersion: number;
  approvedAt: string;
  status: "approved";
}

export function approveCampaign(
  db: SqliteDatabase,
  merchantId: string,
  fixture: Fixture,
  campaignId: string,
  version: number,
  clientPreviewHash: string
): ApproveResult {
  const row = getCampaignRow(db, merchantId, campaignId, version);
  if (row.status !== "draft") {
    throw new ApiError("stale_version", "This version was already approved or queued. Edit to create a new draft.");
  }
  if (version !== latestVersion(db, merchantId, campaignId)) {
    throw new ApiError("stale_version", "A newer draft version exists for this campaign.");
  }

  // Re-verify the facts the preview showed. Any drift invalidates the preview.
  const audience = getAudience(db, merchantId, fixture.customers.channel);
  if (audience.hash !== row.audience_hash) {
    throw new ApiError("stale_preview", "Eligible audience changed since this preview. Review a fresh preview.");
  }
  if (currentInventoryVersion(db, merchantId) !== row.inventory_version) {
    throw new ApiError("stale_preview", "Stock or costs changed since this preview. Review a fresh preview.");
  }
  if (clientPreviewHash !== row.preview_hash) {
    throw new ApiError("stale_preview", "Offer terms changed after this preview was shown. Review a fresh preview.");
  }

  // Business rule: unprofitable or infeasible offers can never be approved.
  const storedOffer = JSON.parse(row.offer_json) as StoredOffer;
  const recheck = computeOffer(db, merchantId, fixture, storedOffer.pricePaise, storedOffer.cap);
  if (!recheck.passes) {
    throw new ApiError("business_rule", `This offer cannot be approved: ${recheck.violations.join(" ")}`);
  }

  const approvedAt = getNow().toISOString();
  const approvalId = `apr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  withTransaction(db, () => {
    db.prepare("UPDATE campaigns SET status = 'approved' WHERE merchant_id = ? AND id = ? AND version = ?").run(
      merchantId,
      campaignId,
      version
    );
    db.prepare(
      "INSERT INTO approvals (id, campaign_id, campaign_version, approver_id, approved_payload_hash, approved_at) VALUES (?,?,?,?,?,?)"
    ).run(approvalId, campaignId, version, "owner-demo", row.preview_hash, approvedAt);
    audit(db, merchantId, "owner-demo", "campaign.approved", `${campaignId}:${version}`, { approvalId });
  });
  return { approvalId, approvedVersion: version, approvedAt, status: "approved" };
}

// ---------------------------------------------------------------- execute

export interface ExecuteReceipt {
  status: "simulated_queued";
  count: number;
  campaignId: string;
  version: number;
  receiptId: string;
  duplicate: boolean;
}

export function executeCampaign(
  db: SqliteDatabase,
  merchantId: string,
  fixture: Fixture,
  campaignId: string,
  version: number,
  clientKey?: string
): ExecuteReceipt {
  const row = getCampaignRow(db, merchantId, campaignId, version);
  if (version !== latestVersion(db, merchantId, campaignId)) {
    throw new ApiError("stale_version", "A newer draft version exists - that supersedes this version.");
  }

  // Idempotency keys are resolved first, so a client key always replays its
  // original stored receipt - even after the campaign reached 'queued'.
  const idempotencyKeyEarly = clientKey?.trim() ? `req:${clientKey.trim()}` : `exec:${campaignId}:${version}`;
  const fingerprint = sha256(`${merchantId}|${campaignId}|${version}`);
  const earlyRequest = db.prepare("SELECT * FROM idempotency_requests WHERE key = ?").get(idempotencyKeyEarly) as
    | { fingerprint: string; response_json: string }
    | undefined;
  if (earlyRequest) {
    if (earlyRequest.fingerprint !== fingerprint) {
      throw new ApiError("conflict", "This idempotency key was used for a different request.");
    }
    // Replay of the same request: report it as a duplicate.
    return { ...(JSON.parse(earlyRequest.response_json) as ExecuteReceipt), duplicate: true };
  }

  // Executing an already-queued version (no matching key) returns a replay receipt.
  if (row.status === "queued") {
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ? AND version = ?").get(campaignId, version) as {
        n: number;
      }
    ).n;
    return { status: "simulated_queued", count, campaignId, version, receiptId: `${campaignId}:${version}`, duplicate: true };
  }
  if (row.status === "draft") {
    throw new ApiError("conflict", "Approve the exact preview before queueing.");
  }

  // Status 'approved': verify every fact the approval was based on.
  const approval = db
    .prepare("SELECT * FROM approvals WHERE campaign_id = ? AND campaign_version = ?")
    .get(campaignId, version) as { id: string; approved_payload_hash: string } | undefined;
  if (!approval || approval.approved_payload_hash !== row.preview_hash) {
    throw new ApiError("stale_preview", "No valid approval matches this version's exact terms.");
  }

  const now = getNow();
  if (now.getTime() >= new Date(row.expires_at).getTime()) {
    throw new ApiError("expired", "The offer validity window has passed. Prepare a fresh offer.");
  }
  if (currentInventoryVersion(db, merchantId) !== row.inventory_version) {
    throw new ApiError("stale_inventory", "Stock or costs changed since approval. Review a fresh preview before queueing.");
  }
  const audience = getAudience(db, merchantId, fixture.customers.channel);
  if (audience.hash !== row.audience_hash) {
    throw new ApiError("stale_consent", "The consent register changed since approval. Review a fresh preview before queueing.");
  }

  const idempotencyKey = idempotencyKeyEarly;


  const receiptId = `rcp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const receipt: ExecuteReceipt = {
    status: "simulated_queued",
    count: audience.eligibleIds.length,
    campaignId,
    version,
    receiptId,
    duplicate: false,
  };

  withTransaction(db, () => {
    // Re-check inside the transaction (serializes concurrent clicks).
    const current = db
      .prepare("SELECT status FROM campaigns WHERE merchant_id = ? AND id = ? AND version = ?")
      .get(merchantId, campaignId, version) as { status: CampaignRow["status"] } | undefined;
    if (!current || current.status !== "approved") {
      throw new ApiError("conflict", "Campaign is no longer in the approved state.");
    }
    const already = (
      db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ? AND version = ?").get(campaignId, version) as { n: number }
    ).n;
    if (already > 0) return; // lost race: nothing to insert

    const insertOutbox = db.prepare(
      "INSERT INTO outbox (id, campaign_id, version, customer_id, channel, status, simulated, idempotency_key, created_at) VALUES (?,?,?,?,?,'simulated_queued',1,?,?)"
    );
    for (const customerId of audience.eligibleIds) {
      const perRecipientKey = sha256(`${campaignId}:${version}:${customerId}:${fixture.customers.channel}`);
      insertOutbox.run(
        `out_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        campaignId,
        version,
        customerId,
        fixture.customers.channel,
        perRecipientKey,
        now.toISOString()
      );
    }
    db.prepare("UPDATE campaigns SET status = 'queued' WHERE merchant_id = ? AND id = ? AND version = ?").run(
      merchantId,
      campaignId,
      version
    );
    db.prepare("INSERT INTO idempotency_requests (key, fingerprint, response_json, created_at) VALUES (?,?,?,?)").run(
      idempotencyKey,
      fingerprint,
      JSON.stringify(receipt),
      now.toISOString()
    );
    audit(db, merchantId, "owner-demo", "campaign.queued_simulated", `${campaignId}:${version}`, {
      count: audience.eligibleIds.length,
      simulated: true,
    });
  });

  return receipt;
}

// ---------------------------------------------------------------- redeem

export interface RedemptionView {
  eventId: string;
  quantity: number;
  amountPaise: number;
  occurredAtIso: string;
  duplicate: boolean;
}

export interface RedeemResult {
  redemption: RedemptionView;
  totals: { redemptions: number; revenuePaise: number; variableCostPaise: number; contributionPaise: number; discountPaise: number };
  cap: number;
}

export function redeemEvent(
  db: SqliteDatabase,
  merchantId: string,
  fixture: Fixture,
  campaignId: string,
  eventId: string
): RedeemResult {
  const version = latestVersion(db, merchantId, campaignId);
  if (version === 0) throw new ApiError("not_found", "Campaign not found for this session.");
  const row = getCampaignRow(db, merchantId, campaignId, version);
  const offer = JSON.parse(row.offer_json) as StoredOffer;

  const event = fixture.simulatedRedemptionEvents.find((e) => e.eventId === eventId);
  if (!event) throw new ApiError("not_found", "Unknown simulated redemption event id.");

  const totalsSoFar = redemptionTotals(db, campaignId, offer);

  // Idempotent replay of the same event: return the existing record unchanged.
  const existing = db
    .prepare("SELECT * FROM redemptions WHERE campaign_id = ? AND event_id = ?")
    .get(campaignId, eventId) as
    | { event_id: string; quantity: number; amount_paise: number; occurred_at: string }
    | undefined;
  if (existing) {
    return {
      redemption: {
        eventId: existing.event_id,
        quantity: existing.quantity,
        amountPaise: existing.amount_paise,
        occurredAtIso: existing.occurred_at,
        duplicate: true,
      },
      totals: totalsSoFar,
      cap: offer.cap,
    };
  }

  if (row.status !== "queued") {
    throw new ApiError("business_rule", "Queue the approved campaign before applying simulated redemptions.");
  }
  if (totalsSoFar.redemptions >= offer.cap) {
    throw new ApiError("cap_reached", `Redemption cap of ${offer.cap} has been reached. No further redemptions are recorded.`);
  }
  if (event.amountPaise !== offer.pricePaise * event.quantity) {
    throw new ApiError("business_rule", "Event amount contradicts the approved offer terms.");
  }

  // Stock recheck at each redemption (cumulative consumption vs current stock).
  withTransaction(db, () => {
    const invRows = db
      .prepare("SELECT sku_id, quantity FROM inventory WHERE merchant_id = ?")
      .all(merchantId) as { sku_id: string; quantity: number }[];
    const stockBySku = new Map(invRows.map((r) => [r.sku_id, r.quantity]));
    for (const c of offer.components) {
      const consumed = totalsSoFar.redemptions * c.quantity + event.quantity * c.quantity;
      if ((stockBySku.get(c.skuId) ?? 0) < consumed) {
        throw new ApiError("business_rule", `Stock exhausted for ${c.skuId}; redemption not recorded.`);
      }
    }
    db.prepare(
      "INSERT INTO redemptions (id, campaign_id, event_id, quantity, amount_paise, occurred_at, simulated, created_at) VALUES (?,?,?,?,?,?,1,?)"
    ).run(
      `red_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      campaignId,
      event.eventId,
      event.quantity,
      event.amountPaise,
      new Date(event.occurredAtIso).toISOString(),
      getNow().toISOString()
    );
    audit(db, merchantId, "fixture", "redemption.recorded_simulated", `${campaignId}:${event.eventId}`, {
      quantity: event.quantity,
      simulated: true,
    });
  });

  return {
    redemption: {
      eventId: event.eventId,
      quantity: event.quantity,
      amountPaise: event.amountPaise,
      occurredAtIso: new Date(event.occurredAtIso).toISOString(),
      duplicate: false,
    },
    totals: redemptionTotals(db, campaignId, offer),
    cap: offer.cap,
  };
}

function redemptionTotals(
  db: SqliteDatabase,
  campaignId: string,
  offer: StoredOffer
): { redemptions: number; revenuePaise: number; variableCostPaise: number; contributionPaise: number; discountPaise: number } {
  const agg = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(amount_paise),0) AS revenue FROM redemptions WHERE campaign_id = ?")
    .get(campaignId) as { n: number; qty: number; revenue: number };
  const cost = offer.bundleCostPaise === null ? 0 : offer.bundleCostPaise * agg.qty;
  const discountPerBundle = Math.max(0, offer.normalPricePaise - offer.pricePaise);
  return {
    redemptions: agg.n,
    revenuePaise: agg.revenue,
    variableCostPaise: cost,
    contributionPaise: agg.revenue - cost,
    discountPaise: discountPerBundle * agg.qty,
  };
}

// ---------------------------------------------------------------- results

export interface CampaignResults {
  campaign: {
    id: string;
    version: number;
    status: CampaignRow["status"];
    offer: StoredOffer;
    copy: StoredCopy;
    expiresAt: string;
    aiMode: string;
    audienceCount: number;
    approvedAt: string | null;
  };
  outbox: { queued: number; simulated: true; sample: { customerId: string; label: string; demoChannelId: string; channel: string; status: string }[] };
  redemptions: {
    simulated: true;
    events: { eventId: string; quantity: number; amountPaise: number; occurredAtIso: string }[];
    redemptions: number;
    revenuePaise: number;
    variableCostPaise: number;
    contributionPaise: number;
    discountPaise: number;
    cap: number;
  };
  availableEvents: { eventId: string; customerId: string }[];
  auditTrail: { action: string; entityId: string; timestamp: string; actorId: string }[];
  caveats: string[];
}

function shortCustomerId(id: string): string {
  // DB ids are tenant-scoped ("mrc_<session>_CUST-001"); display the local part.
  const idx = id.lastIndexOf("_CUST-");
  return idx >= 0 ? "CUST-" + id.slice(idx + "_CUST-".length) : id;
}

export function getCampaignResults(db: SqliteDatabase, merchantId: string, fixture: Fixture, campaignId: string): CampaignResults {
  const version = latestVersion(db, merchantId, campaignId);
  if (version === 0) throw new ApiError("not_found", "Campaign not found for this session.");
  const row = getCampaignRow(db, merchantId, campaignId, version);
  const offer = JSON.parse(row.offer_json) as StoredOffer;
  const copy = JSON.parse(row.copy_json) as StoredCopy;

  const approval = db
    .prepare("SELECT approved_at FROM approvals WHERE campaign_id = ? AND campaign_version = ?")
    .get(campaignId, version) as { approved_at: string } | undefined;

  const outboxRows = db
    .prepare(
      "SELECT o.customer_id, c.display_label, c.demo_channel_id, o.channel, o.status FROM outbox o JOIN customers c ON c.id = o.customer_id WHERE o.campaign_id = ? AND o.version = ? ORDER BY o.customer_id LIMIT 6"
    )
    .all(campaignId, version) as { customer_id: string; display_label: string; demo_channel_id: string; channel: string; status: string }[];
  const outboxCount = (
    db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE campaign_id = ? AND version = ?").get(campaignId, version) as { n: number }
  ).n;

  const redemptionRows = db
    .prepare("SELECT event_id, quantity, amount_paise, occurred_at FROM redemptions WHERE campaign_id = ? ORDER BY occurred_at")
    .all(campaignId) as { event_id: string; quantity: number; amount_paise: number; occurred_at: string }[];
  const totals = redemptionTotals(db, campaignId, offer);

  const auditRows = db
    .prepare("SELECT action, entity_id, timestamp, actor_id FROM audit_events WHERE merchant_id = ? AND entity_id LIKE ? ORDER BY id DESC LIMIT 12")
    .all(merchantId, `${campaignId}%`) as { action: string; entity_id: string; timestamp: string; actor_id: string }[];

  return {
    campaign: {
      id: campaignId,
      version,
      status: row.status,
      offer,
      copy,
      expiresAt: row.expires_at,
      aiMode: row.ai_mode,
      audienceCount: row.audience_count,
      approvedAt: approval?.approved_at ?? null,
    },
    outbox: {
      queued: outboxCount,
      simulated: true,
      sample: outboxRows.map((r) => ({
        customerId: shortCustomerId(r.customer_id),
        label: r.display_label,
        demoChannelId: r.demo_channel_id,
        channel: r.channel,
        status: r.status,
      })),
    },
    redemptions: {
      simulated: true,
      events: redemptionRows.map((r) => ({
        eventId: r.event_id,
        quantity: r.quantity,
        amountPaise: r.amount_paise,
        occurredAtIso: r.occurred_at,
      })),
      redemptions: totals.redemptions,
      revenuePaise: totals.revenuePaise,
      variableCostPaise: totals.variableCostPaise,
      contributionPaise: totals.contributionPaise,
      discountPaise: totals.discountPaise,
      cap: offer.cap,
    },
    availableEvents: fixture.simulatedRedemptionEvents.map((e) => ({ eventId: e.eventId, customerId: e.customerId })),
    auditTrail: auditRows.map((r) => ({ action: r.action, entityId: r.entity_id, timestamp: r.timestamp, actorId: r.actor_id })),
    caveats: [
      "Simulated campaign outcomes - no real messages were sent and no real customers were contacted.",
      "Contribution is bundle revenue minus variable cost. It is not proven incremental profit; some customers may have bought at full price anyway.",
      "Variable costs cover ingredients and packaging only - not rent, labour, tax or spoilage.",
      "Discount exposure assumes every redemption uses the offer; actual demand is not guaranteed.",
    ],
  };
}
