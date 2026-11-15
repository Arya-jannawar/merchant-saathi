"use client";

/** Typed fetch helpers for browser components. Errors surface the server envelope. */

/**
 * Multi-business support: every request carries the active business id; the
 * server only honors ids owned by this session. Persisted per browser.
 */
let activeMerchantId: string | null =
  typeof window === "undefined" ? null : window.localStorage.getItem("ms_active_merchant");

export function setActiveMerchantId(id: string | null): void {
  activeMerchantId = id;
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem("ms_active_merchant", id);
  else window.localStorage.removeItem("ms_active_merchant");
}

export function getActiveMerchantId(): string | null {
  return activeMerchantId;
}

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
  try {
    return await rawApi<T>(path, init);
  } catch (err) {
    // Self-heal a stale business selector (e.g. the active business was removed
    // in another tab): drop it and retry once against the session's default.
    if (
      err instanceof ApiClientError &&
      err.code === "not_found" &&
      activeMerchantId !== null
    ) {
      setActiveMerchantId(null);
      return rawApi<T>(path, init);
    }
    throw err;
  }
}

/** Same session/selector headers as api(), but returns the raw body (e.g. a PDF). */
export async function apiBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (activeMerchantId) headers["x-merchant-id"] = activeMerchantId;
  const res = await fetch(path, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiClientError(res.status, body?.error ?? { code: "unknown", message: `Request failed (${res.status})` });
  }
  return await res.blob();
}

async function rawApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (activeMerchantId) headers["x-merchant-id"] = activeMerchantId;
  const res = await fetch(path, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
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
  merchants: MerchantDto[];
  activeMerchantId: string | null;
  merchant?: {
    name: string;
    fixtureVersion: string;
    timezone: string;
    currency: string;
    domain: { id: string; label: string; emoji: string };
  };
  bundleHint: string;
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

export interface MerchantDto {
  id: string;
  name: string;
  fixtureVersion: string;
  isDefault: boolean;
  domain: { id: string; label: string; emoji: string };
}

export interface DomainOptionDto {
  id: string;
  label: string;
  emoji: string;
  pitch: string;
  bundleName: string;
  fixtureVersion: string;
}

export interface InsightsDayDto {
  dayLabel: string;
  orders: number;
  netSalesPaise: number;
}

export interface DemoInsightsDto {
  merchantId: string;
  merchantName: string;
  nowIso: string;
  windowLabels: { previous: string; current: string };
  days: { previous: InsightsDayDto[]; current: InsightsDayDto[] };
  funnel: {
    customers: number;
    eligible: number;
    queued: number | null;
    redemptions: number | null;
    contributionPaise: number | null;
    simulated: true;
  } | null;
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
  actionPlan: {
    text: string;
    action?: { kind: "set-price"; valuePaise: number } | { kind: "set-cap"; value: number };
  }[];
  assumptions: string[];
  copy: { title: string; body: string };
  copyLocale: "en" | "hi";
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
  merchantName: string;
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

export interface OperationsDto {
  merchantId: string;
  merchantName: string;
  windowLabel: string;
  targetCoverDays: number;
  lines: {
    skuId: string;
    skuName: string;
    stock: number;
    dailyRate: number | null;
    daysOfCover: number | null;
    status: "out" | "critical" | "low" | "healthy";
    campaignDrawDown: number;
    projectedAfterCampaign: number;
    restockUnits: number;
    restockCostPaise: number;
  }[];
  restockTotalUnits: number;
  restockTotalCostPaise: number;
  briefing: string[];
  serve: {
    consents: { active: number; revoked: number; none: number; channel: string };
    champions: { label: string; demoChannelId: string; units: number; spendPaise: number }[];
  };
}

export interface AssistantChatDto {
  answer: string;
  reasoning: string[];
  followUps: string[];
  mode: "live" | "fixture" | "fallback";
  note: string | null;
  intent: string | null;
}

export interface AssistantSettingsDto {
  configured: boolean;
  maskedKey: string | null;
  model: string | null;
  baseUrl: string | null;
  setAtIso: string | null;
}

// ---------------------------------------------------------------- planning

export interface ImportPreviewDto {
  batchToken: string;
  filename: string;
  checksum: string;
  delimiter: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  alreadyImportedBefore: number;
  periodStart: string | null;
  periodEnd: string | null;
  unsupportedReason: string | null;
  rows: {
    rowNumber: number;
    occurredAt: string;
    eventType: string;
    amountPaise: number;
    method: string | null;
    note: string | null;
    status: "import" | "skip-duplicate" | "skip-cancelled" | "conflict";
    reason: string | null;
  }[];
}

export interface ImportReceiptDto {
  batchId: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  periodStart: string | null;
  periodEnd: string | null;
  duplicateBatch: boolean;
}

export interface ImportBatchDto {
  id: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsConflicting: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  reversedAt: string | null;
}

export interface MonthBucketDto {
  month: string;
  label: string;
  netSalesPaise: number;
  grossProfitPaise: number;
  grossMarginPct: number | null;
  tradingDays: number;
}

export interface YearReportDto {
  scope: "calendar" | "financial";
  yearLabel: string;
  months: MonthBucketDto[];
  highestSalesMonth: { month: string; label: string; netSalesPaise: number } | null;
  highestProfitMonth: { month: string; label: string; grossProfitPaise: number } | null;
  coverageNote: string | null;
  tieNote: string | null;
  totalNetSalesPaise: number;
  totalGrossProfitPaise: number;
}

export interface ForecastCandidateDto {
  model: "ridge" | "seasonal-naive";
  maeRupees: number;
  wapePct: number | null;
}

export interface TomorrowForecastDto {
  usable: boolean;
  reason: string | null;
  tomorrowDate: string;
  selectedModel: "ridge" | "seasonal-naive" | null;
  predictedRupees: number | null;
  baseline: ForecastCandidateDto | null;
  ridge: ForecastCandidateDto | null;
  trainingDays: number;
  lastTrainingDate: string | null;
  coverageDays: number;
  explanation: string[];
}

export interface FestivalOpportunityDto {
  festival: { id: string; name: string; date: string; region: string; source: string; status: string; checkedOn: string };
  daysAway: number;
  leadTimeDays: number;
  deadlinePassed: boolean;
  deadlineLabel: string;
  historical: {
    comparableWeeks: number;
    comparableAvgNetPaise: number;
    festivalWeekNetPaise: number;
    salesChangePct: number | null;
    comparableAvgProfitPaise: number;
    festivalWeekProfitPaise: number;
    profitChangePaise: number | null;
    confidence: string;
  } | null;
  suggestion: string;
  estimatedContributionPaise: number | null;
}

export interface FestivalPlanDto {
  asOf: string;
  region: string;
  opportunities: FestivalOpportunityDto[];
}

export interface DepositRequestDto {
  id: string;
  orderRef: string;
  description: string;
  orderPaise: number;
  depositPaise: number;
  remainingPaise: number;
  status: "pending" | "collected";
  linkId: string;
  createdAt: string;
  collectedAt: string | null;
}

export interface ServiceCatalogueDto {
  id: string;
  title: string;
  category: string;
  summary: string;
  merchantJob: string;
  paytmHypothesis: string;
  sourceUrl: string;
  sourceEstablishes: string;
  checkedOn: string;
  verification: string;
}
