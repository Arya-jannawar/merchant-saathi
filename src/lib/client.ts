"use client";

/** Typed fetch helpers for browser components. Errors surface the server envelope. */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    retryable?: boolean;
  };
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const errBody = body as ApiErrorBody | null;
    throw new ApiClientError(res.status, errBody?.error ?? { code: "unknown", message: `Request failed (${res.status})` });
  }
  return body as T;
}

// ---------------------------------------------------------------- DTOs

export interface DemoStateDto {
  seeded: boolean;
  sessionId: string;
  merchant?: { name: string; fixtureVersion: string; timezone: string; currency: string };
  nowIso: string;
  clockInjected: boolean;
  aiMode: "fixture" | "live";
  kpis?: {
    previous: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    current: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    ordersDeltaPct: number | null;
    salesDeltaPct: number | null;
  };
  audience?: { eligible: number; excluded: number; channel: string };
  hint?: string;
}

export interface EvidenceEntryDto {
  id: string;
  label: string;
  definition: string;
  valueLabel: string;
  period: string;
  source: string;
}

export interface OpportunitiesDto {
  dataMode: string;
  fixtureVersion: string;
  nowIso: string;
  windowLabels: { previous: string; current: string };
  items: {
    id: string;
    observation: string;
    metricIds: string[];
    limitations: string[];
    windows: {
      previous: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
      current: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    };
    suggestedOffer: { pricePaise: number; cap: number; bundleName: string; normalPricePaise: number };
    evidence: EvidenceEntryDto[];
  }[];
  lowDataReason: string | null;
  eligibility: {
    previousOrders: number;
    currentOrders: number;
    minOrdersRequired: number;
    declinePct: number | null;
    declineThresholdPct: number;
  };
}

export interface OfferComputationDto {
  pricePaise: number;
  normalPricePaise: number;
  bundleCostPaise: number | null;
  contributionPaise: number | null;
  marginPct: number | null;
  floorPct: number;
  passes: boolean;
  violations: string[];
  capacity: number;
  requestedCap: number;
  capWithinCapacity: boolean;
  discountPaise: number;
  discountPct: number;
  maxDiscountExposurePaise: number;
  atCap: {
    bundles: number;
    revenuePaise: number;
    variableCostPaise: number;
    contributionPaise: number;
    remainingBySku: { skuId: string; quantity: number }[];
  } | null;
}

export interface DraftResponseDto {
  campaignId: string;
  version: number;
  status: "draft";
  offer: {
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
  };
  computed: OfferComputationDto;
  headline: string;
  explanation: string;
  assumptions: string[];
  copy: { title: string; body: string };
  copySource: "model" | "template";
  aiMode: "live" | "fixture" | "fallback";
  aiNote: string | null;
  evidence: EvidenceEntryDto[];
  evidenceIds: string[];
  audience: { eligibleCount: number; excludedCount: number; channel: string };
  expiresAt: string;
  validityLabel: string;
  previewHash: string;
}

export interface ApproveResponseDto {
  approvalId: string;
  approvedVersion: number;
  approvedAt: string;
  status: "approved";
}

export interface ExecuteResponseDto {
  status: "simulated_queued";
  count: number;
  campaignId: string;
  version: number;
  receiptId: string;
  duplicate: boolean;
}

export interface CampaignResultsDto {
  campaign: {
    id: string;
    version: number;
    status: "draft" | "approved" | "queued";
    offer: DraftResponseDto["offer"];
    copy: { title: string; body: string };
    expiresAt: string;
    aiMode: string;
    audienceCount: number;
    approvedAt: string | null;
  };
  outbox: {
    queued: number;
    simulated: true;
    sample: { customerId: string; label: string; demoChannelId: string; channel: string; status: string }[];
  };
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

export interface RedeemResponseDto {
  redemption: { eventId: string; quantity: number; amountPaise: number; occurredAtIso: string; duplicate: boolean };
  totals: { redemptions: number; revenuePaise: number; variableCostPaise: number; contributionPaise: number; discountPaise: number };
  cap: number;
}

export interface ResetResponseDto {
  fixtureVersion: string;
  merchantName: string;
  reset: boolean;
}
