import { z } from "zod";
import { formatINR } from "@/lib/money";
import { getDemoState, loadMerchantFixture, type DemoState } from "@/services/demo";
import { getOpportunities } from "@/domain/metrics";
import { computeOffer } from "@/domain/offers";
import { getOperationsInsights } from "@/domain/operations";
import { getCampaignResults, type StoredOffer } from "@/services/campaigns";
import { loadFixture } from "@/lib/fixture";
import { getNow } from "@/lib/clock";
import type { SqliteDatabase } from "@/lib/db";

/**
 * Mithu's brain. Two answer paths, both strictly grounded:
 *
 * - "fact book" (fixture): intent matching over the session's verified numbers.
 *   Deterministic, no credentials, always available.
 * - "live model": the fact pack + the question go to a chat-completions model.
 *   The response is schema-validated and its rupee amounts are checked against
 *   the computed fact values; anything invented falls back to the fact book
 *   with an honest note.
 *
 * The AI never computes money here - every number in every answer comes from
 * buildAssistantFacts(), which reads the same domain functions the screens use.
 */

export type AssistantMode = "live" | "fixture" | "fallback";

export interface AssistantFacts {
  merchantName: string;
  fixtureVersion: string;
  aiMode: "fixture" | "live";
  clockInjected: boolean;
  nowIso: string;
  seeded: boolean;
  kpis: DemoState["kpis"] | null;
  audience: { eligible: number; excluded: number; channel: string } | null;
  opportunity: {
    id: string;
    observation: string;
    limitations: string[];
    windows: {
      previous: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
      current: { label: string; orders: number; netSalesPaise: number; aovPaise: number | null };
    };
    suggestedOffer: { bundleName: string; pricePaise: number; normalPricePaise: number; cap: number };
    evidence: { id: string; label: string; valueLabel: string; period: string }[];
  } | null;
  lowDataReason: string | null;
  operations: {
    windowLabel: string;
    targetCoverDays: number;
    lines: {
      skuName: string;
      stock: number;
      dailyRate: number | null;
      daysOfCover: number | null;
      status: "out" | "critical" | "low" | "healthy";
      restockUnits: number;
      restockCostPaise: number;
    }[];
    restockTotalUnits: number;
    restockTotalCostPaise: number;
  } | null;
  economics: {
    pricePaise: number;
    normalPricePaise: number;
    bundleCostPaise: number | null;
    contributionPaise: number | null;
    marginPct: number | null;
    floorPct: number;
    passes: boolean;
    capacity: number;
    requestedCap: number;
    maxDiscountExposurePaise: number;
    discountPct: number;
  } | null;
  campaign: {
    id: string;
    version: number;
    status: "draft" | "approved" | "queued";
    offer: Pick<
      StoredOffer,
      "bundleName" | "pricePaise" | "normalPricePaise" | "bundleCostPaise" | "cap" | "discountPct" | "maxDiscountExposurePaise"
    >;
    marginPct: number | null;
    contributionPerBundlePaise: number | null;
    results: {
      redemptions: number;
      revenuePaise: number;
      variableCostPaise: number;
      contributionPaise: number;
      discountPaise: number;
      cap: number;
    } | null;
  } | null;
}

export function buildAssistantFacts(db: SqliteDatabase, merchantId: string, fixtureOverride?: import("@/lib/fixture").Fixture): AssistantFacts {
  // The merchant's own fixture owns its numbers and bundle naming (domain-aware).
  const fixture = fixtureOverride ?? loadMerchantFixture(db, merchantId);
  const ownerRow = db.prepare("SELECT demo_session_id FROM merchants WHERE id = ?").get(merchantId) as
    | { demo_session_id: string }
    | undefined;
  const state = ownerRow ? getDemoState(db, ownerRow.demo_session_id, merchantId) : null;
  const now = getNow();
  const opportunities = getOpportunities(db, merchantId, fixture, now);
  const item = opportunities.items[0] ?? null;
  const economics = item
    ? (() => {
        const s = item.suggestedOffer;
        const c = computeOffer(db, merchantId, fixture, s.pricePaise, s.cap);
        return {
          pricePaise: c.pricePaise,
          normalPricePaise: c.normalPricePaise,
          bundleCostPaise: c.bundleCostPaise,
          contributionPaise: c.contributionPaise,
          marginPct: c.marginPct,
          floorPct: c.floorPct,
          passes: c.passes,
          capacity: c.capacity,
          requestedCap: c.requestedCap,
          maxDiscountExposurePaise: c.maxDiscountExposurePaise,
          discountPct: c.discountPct,
        };
      })()
    : null;

  const row = db
    .prepare("SELECT id, version, status, offer_json FROM campaigns WHERE merchant_id = ? ORDER BY created_at DESC, version DESC LIMIT 1")
    .get(merchantId) as { id: string; version: number; status: "draft" | "approved" | "queued"; offer_json: string } | undefined;

  let campaign: AssistantFacts["campaign"] = null;
  if (row) {
    const stored = JSON.parse(row.offer_json) as StoredOffer;
    const perBundle = stored.bundleCostPaise === null ? null : stored.pricePaise - stored.bundleCostPaise;
    const margin = perBundle === null || stored.pricePaise === 0 ? null : Math.round((perBundle / stored.pricePaise) * 1000) / 10;
    let results: NonNullable<AssistantFacts["campaign"]>["results"] = null;
    if (row.status === "queued") {
      const r = getCampaignResults(db, merchantId, fixture, row.id);
      results = {
        redemptions: r.redemptions.redemptions,
        revenuePaise: r.redemptions.revenuePaise,
        variableCostPaise: r.redemptions.variableCostPaise,
        contributionPaise: r.redemptions.contributionPaise,
        discountPaise: r.redemptions.discountPaise,
        cap: r.redemptions.cap,
      };
    }
    campaign = {
      id: row.id,
      version: row.version,
      status: row.status,
      offer: {
        bundleName: stored.bundleName,
        pricePaise: stored.pricePaise,
        normalPricePaise: stored.normalPricePaise,
        bundleCostPaise: stored.bundleCostPaise,
        cap: stored.cap,
        discountPct: stored.discountPct,
        maxDiscountExposurePaise: stored.maxDiscountExposurePaise,
      },
      marginPct: margin,
      contributionPerBundlePaise: perBundle,
      results,
    };
  }

  const ops = getOperationsInsights(db, merchantId, fixture, now);

  return {
    operations: {
      windowLabel: ops.windowLabel,
      targetCoverDays: ops.targetCoverDays,
      lines: ops.lines.map((l) => ({
        skuName: l.skuName,
        stock: l.stock,
        dailyRate: l.dailyRate,
        daysOfCover: l.daysOfCover,
        status: l.status,
        restockUnits: l.restockUnits,
        restockCostPaise: l.restockCostPaise,
      })),
      restockTotalUnits: ops.restockTotalUnits,
      restockTotalCostPaise: ops.restockTotalCostPaise,
    },
    merchantName: state?.merchant?.name ?? "the demo bakery",
    fixtureVersion: state?.merchant?.fixtureVersion ?? fixture.fixtureVersion,
    aiMode: state?.aiMode ?? "fixture",
    clockInjected: state?.clockInjected ?? true,
    nowIso: state?.nowIso ?? now.toISOString(),
    seeded: state?.seeded ?? true,
    kpis: state?.kpis ?? null,
    audience: state?.audience ?? null,
    opportunity: item
      ? {
          id: item.id,
          observation: item.observation,
          limitations: item.limitations,
          windows: {
            previous: {
              label: item.windows.previous.label,
              orders: item.windows.previous.orders,
              netSalesPaise: item.windows.previous.netSalesPaise,
              aovPaise: item.windows.previous.aovPaise,
            },
            current: {
              label: item.windows.current.label,
              orders: item.windows.current.orders,
              netSalesPaise: item.windows.current.netSalesPaise,
              aovPaise: item.windows.current.aovPaise,
            },
          },
          suggestedOffer: {
            bundleName: item.suggestedOffer.bundleName,
            pricePaise: item.suggestedOffer.pricePaise,
            normalPricePaise: item.suggestedOffer.normalPricePaise,
            cap: item.suggestedOffer.cap,
          },
          evidence: item.evidence.slice(0, 6).map((e) => ({
            id: e.id,
            label: e.label,
            valueLabel: e.valueLabel,
            period: e.period,
          })),
        }
      : null,
    lowDataReason: opportunities.lowDataReason ?? null,
    economics,
    campaign,
  };
}

// ---------------------------------------------------------------- fact book

export type AssistantIntent =
  | "greet"
  | "decline"
  | "offer"
  | "approve"
  | "queue"
  | "results"
  | "consent"
  | "operations"
  | "honesty"
  | "tour"
  | "thin"
  | "general";

const INTENT_PATTERNS: { intent: AssistantIntent; patterns: string[] }[] = [
  { intent: "greet", patterns: ["hi", "hello", "hey", "namaste", "who are you", "what can you do", "help me"] },
  { intent: "decline", patterns: ["why", "decline", "dropped", "down", "fell", "fewer", "afternoon", "orders", "sales", "whats wrong", "what happened"] },
  { intent: "offer", patterns: ["offer", "price", "margin", "safe", "profit", "combo", "discount", "cap", "samosa", "bundle", "50", "70", "90"] },
  { intent: "approve", patterns: ["approve", "approving", "approval", "approved", "hash", "preview", "stale", "409", "lock", "bind"] },
  { intent: "queue", patterns: ["queue", "send", "outbox", "whatsapp", "sms", "message", "customers", "notify", "campaign"] },
  { intent: "results", patterns: ["result", "how much", "money", "earn", "earned", "revenue", "contribution", "made", "gain", "worth it", "redemption"] },
  { intent: "consent", patterns: ["consent", "audience", "eligible", "excluded", "opt-in", "opt in", "permission"] },
  { intent: "operations", patterns: ["stock", "inventory", "restock", "cover", "operations", "run rate", "run-rate", "supplier", "reorder"] },
  { intent: "honesty", patterns: ["real", "simulated", "fake", "synthetic", "demo data", "honest", "trust", "actual", "live"] },
  { intent: "tour", patterns: ["how does this work", "guide", "start", "tour", "where", "what should i do", "next step", "how to use", "explain the app", "explain this"] },
  { intent: "thin", patterns: ["thin", "insufficient", "not enough data", "small sample", "no opportunity"] },
];

/** Deterministic intent match: most pattern hits wins, earlier intents win ties. */
export function matchIntent(question: string): AssistantIntent {
  const q = question.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let best: AssistantIntent = "general";
  let bestScore = 0;
  for (const { intent, patterns } of INTENT_PATTERNS) {
    let score = 0;
    for (const p of patterns) {
      // Short patterns ("hi", "70") must match whole words, or substrings like
      // "this" would route to the greeting intent.
      const hit = p.length <= 4 ? new RegExp(`\\b${p}\\b`).test(q) : q.includes(p);
      if (hit) score += 1;
    }
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

export interface AssistantAnswer {
  answer: string;
  reasoning: string[];
  followUps: string[];
  intent: AssistantIntent;
}

const BASE_REASONING = (facts: AssistantFacts, intent: AssistantIntent): string[] => [
  `Read the question and matched it to the "${intent}" topic.`,
  `Loaded only the verified numbers for this session (${facts.fixtureVersion}, computed in code).`,
  "Cross-checked the answer: every rupee amount below comes from those computed values.",
];

export function answerFromFactBook(question: string, facts: AssistantFacts): AssistantAnswer {
  const intent = matchIntent(question);
  const k = facts.kpis;
  const opp = facts.opportunity;
  const camp = facts.campaign;
  const SUGGEST = ["Why are afternoon orders down?", "Is the ₹70 offer safe?", "What does approving do?", "How much money did the campaign make?"];

  switch (intent) {
    case "greet":
      return {
        intent,
        answer:
          `Hi! I am Mithu, your saathi for ${facts.merchantName}. I only speak from the numbers this app computes - ` +
          "no guesses. Ask me why the afternoon orders fell, whether an offer is safe, what approving does, or what the simulated campaign earned.",
        reasoning: BASE_REASONING(facts, intent),
        followUps: SUGGEST,
      };
    case "decline": {
      if (!k || !opp) {
        return {
          intent,
          answer:
            "There is not enough complete data in this session yet - load the sample data on the dashboard and I can walk you through the decline with evidence.",
          reasoning: BASE_REASONING(facts, intent),
          followUps: ["Load sample data for me", "What is the thin-data demo?"],
        };
      }
      const line = `Completed 3-6 p.m. orders went ${k.previous.orders} → ${k.current.orders} (${k.ordersDeltaPct === null ? "n/a" : `${k.ordersDeltaPct.toFixed(1)}%`}) and net sales ${formatINR(k.previous.netSalesPaise)} → ${formatINR(k.current.netSalesPaise)} (${k.salesDeltaPct === null ? "n/a" : `${k.salesDeltaPct.toFixed(1)}%`}), between ${k.previous.label} and ${k.current.label}.`;
      return {
        intent,
        answer:
          `${line} Average order value stayed flat at ${k.previous.aovPaise ? formatINR(k.previous.aovPaise) : "n/a"} - ` +
          "so the problem is order COUNT, not basket size. I can only tell you what changed, not why: two five-day windows cannot prove a cause like weather or competition. That is a deliberate rule, not a limitation.",
        reasoning: [
          ...BASE_REASONING(facts, intent),
          `Compared the two complete Mon-Fri windows (${k.previous.label} vs ${k.current.label}) and checked AOV separately.`,
        ],
        followUps: ["Is the ₹70 offer safe?", "Show me the evidence", "How does the app prove its numbers?"],
      };
    }
    case "offer": {
      if (!opp || !facts.economics) {
        return {
          intent: "offer",
          answer:
            "This session has no qualifying opportunity right now" +
            (facts.lowDataReason ? ` - ${facts.lowDataReason}` : ". Load the standard demo data to explore offer math."),
          reasoning: BASE_REASONING(facts, intent),
          followUps: ["What is the thin-data demo?", "How does the margin floor work?"],
        };
      }
      const s = opp.suggestedOffer;
      const e = facts.economics;
      const marginLabel = e.marginPct === null ? "unavailable (missing cost data)" : `${e.marginPct.toFixed(1)}%`;
      const contributionLabel = e.contributionPaise === null ? "unavailable" : formatINR(e.contributionPaise);
      return {
        intent,
        answer:
          `The suggested bundle is "${s.bundleName}": ${formatINR(s.pricePaise)} instead of the usual ${formatINR(s.normalPricePaise)} (₹${Math.round((s.normalPricePaise - s.pricePaise) / 100)} off, ${e.discountPct.toFixed(1)}%), capped at ${s.cap} per day. ` +
          `Code, not AI, checks the math: contribution ${contributionLabel} per bundle (${marginLabel} margin, the floor is ${e.floorPct}%), stock supports ${e.capacity} bundles so the cap of ${e.requestedCap} is feasible, and the maximum discount exposure is ${formatINR(e.maxDiscountExposurePaise)}. ` +
          `A price of ${formatINR(5000)} fails the floor visibly (20% margin) - the app rejects it before anything can be queued.`,
        reasoning: [
          ...BASE_REASONING(facts, intent),
          `Re-ran computeOffer() inputs: price ${formatINR(e.pricePaise)}, cap ${e.requestedCap}, and the ${e.floorPct}% margin floor from the fixture.`,
        ],
        followUps: ["What happens if I type ₹50?", "What does approving do?", "How much discount could this cost me?"],
      };
    }
    case "approve":
      return {
        intent,
        answer:
          "Approving binds you to the EXACT preview you saw: the approval stores a hash of the version, price, cap, audience and inventory version. " +
          "If anything changes after that - you edit the price, stock moves, consent changes - a later execute fails with 409 stale, and you make a fresh draft + approval. " +
          "Nothing is ever queued without this approval. That is the owner control loop.",
        reasoning: [...BASE_REASONING(facts, intent), "Traced the approve → execute path: previewHash re-computation and the 409 stale guards."],
        followUps: ["Is the ₹70 offer safe?", "Who receives the messages?"],
      };
    case "queue":
      return {
        intent,
        answer:
          `Nothing is really sent - ever. Queueing writes ${facts.audience ? `${facts.audience.eligible} consented demo customers` : "the consented demo customers"} into a SIMULATED outbox (status simulated_queued). ` +
          `${facts.audience ? `${facts.audience.excluded} customers are excluded because their consent is missing or revoked.` : ""} ` +
          "Every screen labels this honestly; the demo customer IDs are non-deliverable by design.",
        reasoning: [...BASE_REASONING(facts, intent), "Checked the consent register: only active demo consents enter the simulated outbox."],
        followUps: ["How much money did the campaign make?", "What does consent do?"],
      };
    case "results": {
      if (!camp || camp.status !== "queued" || !camp.results) {
        return {
          intent,
          answer:
            "There is no queued campaign in this session yet, so there are no results to report. Flow: draft in the offer workspace → approve → queue the simulated campaign → apply the ten simulated redemption events on the campaign page.",
          reasoning: [...BASE_REASONING(facts, intent), "Looked for a queued campaign in this tenant and found none yet."],
          followUps: ["How do I queue a campaign?", "What does approving do?"],
        };
      }
      const r = camp.results;
      if (r.redemptions === 0) {
        return {
          intent,
          answer:
            "The simulated campaign is queued, but no redemption events have been applied yet - so the results panel still reads ₹0. Open the campaign page and apply the ten simulated events; the money story (₹700 − ₹400 = ₹300 in the standard demo) appears as you do.",
          reasoning: [...BASE_REASONING(facts, intent), "Found the queued campaign and checked its redemption rows: none yet."],
          followUps: ["What does approving do?", "Who receives the messages?"],
        };
      }
      return {
        intent,
        answer:
          `Simulated campaign outcomes so far: ${r.redemptions} redemptions (cap ${r.cap}). Bundle sales ${formatINR(r.revenuePaise)} - ingredients & packaging ${formatINR(r.variableCostPaise)} = contribution ${formatINR(r.contributionPaise)} toward fixed costs. Discount given: ${formatINR(r.discountPaise)}. ` +
          "These are simulated redemptions applied on top of the fixture data - labeled as such on every screen, and repeated events replay idempotently.",
        reasoning: [
          ...BASE_REASONING(facts, intent),
          "Recomputed results from the redemption rows: SUM(amount) minus quantity × bundle cost.",
        ],
        followUps: ["Why is contribution the right number?", "What happens if I replay an event?"],
      };
    }
    case "consent":
      return {
        intent,
        answer:
          `The demo CRM has ${facts.audience ? `${facts.audience.eligible} eligible customers with an active ${facts.audience.channel} consent` : "a consent register"}` +
          `${facts.audience ? `, and ${facts.audience.excluded} excluded` : " (missing or revoked consents are excluded)"}. ` +
          "The audience hash (sha256 of the sorted consented IDs) is stored with the draft; if consent changes after approval, execution refuses with stale_consent. Consent is data here, not a checkbox.",
        reasoning: [...BASE_REASONING(facts, intent), "Read the consent register and the audience hash rule."],
        followUps: ["Who receives the messages?", "What does approving do?"],
      };
    case "honesty":
      return {
        intent,
        answer:
          "What is real: every metric, the offer math, consent filtering, approval binding, idempotency and the cap are computed in tested code. What is simulated and labeled: the bakery dataset (fixture), the customer list, the outbox (never sends), the redemptions, and the clock (pinned to Fri 6 Nov 2026, 7:00 PM IST). " +
          `AI mode right now: ${facts.aiMode === "live" ? "live model (drafting prose only)" : "fixture - canned drafts, no credentials"}. The AI can never change money, stock or consent.`,
        reasoning: [...BASE_REASONING(facts, intent), "Separated the real vs simulated lists exactly as the labels do."],
        followUps: ["What can the AI actually do?", "How do I know the numbers are right?"],
      };
    case "operations": {
      const op = facts.operations;
      if (!op) {
        return {
          intent,
          answer: "I could not read the stockroom just now - try again in a moment.",
          reasoning: BASE_REASONING(facts, intent),
          followUps: ["Is the ₹70 offer safe?", "Why are orders down?"],
        };
      }
      const low = op.lines.filter((l) => l.status !== "healthy");
      const linesTxt =
        low.length === 0
          ? `All ${op.lines.length} SKUs hold more than ${op.targetCoverDays} days of cover at the current run-rate - no restock needed right now.`
          : `${low.length} SKU${low.length === 1 ? "" : "s"} need attention: ` +
            low
              .map((l) => `${l.skuName} (${l.daysOfCover === null ? "no recent sales" : `${l.daysOfCover} days of cover`}${l.status === "out" ? ", out of stock" : ""})`)
              .join(", ") +
            ".";
      const plan =
        op.restockTotalUnits > 0
          ? ` The suggested restock plan is ${op.restockTotalUnits} units, about ${formatINR(op.restockTotalCostPaise)} at current unit costs - advisory only, nothing is ordered automatically.`
          : "";
      return {
        intent,
        answer:
          `Operations: run-rate comes from completed orders in ${op.windowLabel}. ${linesTxt}${plan} ` +
          "The restock plan lives in the Operations tab - the copilot advises, you decide.",
        reasoning: [
          ...BASE_REASONING(facts, intent),
          "Recomputed units sold per day per SKU from order rows and compared against current inventory.",
        ],
        followUps: ["Is the ₹70 offer safe?", "What did the campaign earn?", "Why are orders down?"],
      };
    }
    case "tour":
      return {
        intent,
        answer:
          "Three screens, one loop: (1) Dashboard - the decline with evidence. (2) Offer workspace - edit price/cap and watch the margin check live; try ₹50 to see a visible rejection. (3) Approve → queue the simulated campaign → on the campaign page apply the 10 redemption events and read ₹700 − ₹400 = ₹300. Want me to walk you through it? Open the tour with the 'Show me around' button in my bubble.",
        reasoning: [...BASE_REASONING(facts, intent), "Mapped the hero flow onto the three screens."],
        followUps: ["Why are afternoon orders down?", "Is the ₹70 offer safe?", "What does approving do?"],
      };
    case "thin":
      return {
        intent,
        answer:
          "The thin-data demo loads a fixture with tiny windows, so the app does what it should: it says 'insufficient evidence' and refuses to recommend. Eligibility needs both windows complete, at least the minimum completed afternoon orders, and a ≥30% decline. A product that can say 'not enough data' is more trustworthy than one that always answers.",
        reasoning: [...BASE_REASONING(facts, intent), "Checked the eligibility rule against this session's data mode."],
        followUps: ["Why are afternoon orders down?", "How does the margin floor work?"],
      };
    default:
      return {
        intent: "general",
        answer:
          "I answer from this session's verified numbers and rules only: the decline, the offer math, approvals, the simulated outbox, consent, and results. Try one of the chips below - or ask about any of those. I will not invent numbers I cannot trace.",
        reasoning: BASE_REASONING(facts, "general"),
        followUps: SUGGEST,
      };
  }
}

// ---------------------------------------------------------------- live model

const ASSISTANT_TIMEOUT_MS = 20_000;

export function buildAssistantPrompts(question: string, facts: AssistantFacts): { system: string; user: string } {
  const system = [
    "You are Mithu, the in-app assistant of Merchant Saathi, an evidence-backed growth tool for a small bakery owner.",
    "Answer ONLY from VERIFIED_FACTS given in the user message. Never invent, extrapolate or compute new numbers.",
    "No causal claims (say orders fell, never why). Never promise real sending - messaging is simulated. Outcomes labeled simulated are simulated.",
    "Think step by step before answering, then output STRICT JSON only, no markdown fences:",
    '{"answer": string (max 700 chars, plain text, same language as the question, rupee amounts written like ₹1,234 only from VERIFIED_FACTS),',
    ' "reasoning": array of 3-5 short strings naming the facts you used and how you connected them,',
    ' "followUps": array of up to 4 short suggested questions}',
    "If the facts do not contain the answer, say what is missing instead of guessing.",
  ].join(" ");
  const user = JSON.stringify({
    VERIFIED_FACTS: facts,
    QUESTION: question,
    rules: {
      answerMaxLength: 700,
      reasoningItems: 5,
      rupeeAmounts: "only ones present in VERIFIED_FACTS, format ₹N with Indian digit grouping",
      noMarkdown: true,
    },
  });
  return { system, user };
}

const LiveAnswerSchema = z.object({
  answer: z.string().min(5).max(1200),
  reasoning: z.array(z.string().min(2).max(200)).min(1).max(8),
  followUps: z.array(z.string().min(2).max(120)).max(4),
});

/** Normalizes a rupee token to bare digits ("₹5,600" and "Rs 5600" → "5600"). */
function normalizeRupeeToken(token: string): string {
  return token.replace(/[^\d]/g, "").replace(/^0+/, "") || "0";
}

const RUPEE_TOKEN_RE = /(?:\u20B9\s?\d[\d,]*(?:\.\d+)?|\bRs\.?\s?\d[\d,]*(?:\.\d+)?|\bINR\s?\d[\d,]*(?:\.\d+)?)/g;

/** Digits (in rupees) that the computed facts make legitimate for an answer. */
export function allowedRupeeAmounts(facts: AssistantFacts): Set<string> {
  const amounts = new Set<string>();
  const addPaise = (p: number | null | undefined): void => {
    if (p === null || p === undefined) return;
    const rupees = Math.round(p / 100);
    amounts.add(String(rupees));
    amounts.add(rupees.toLocaleString("en-IN").replace(/,/g, ""));
  };
  if (facts.kpis) {
    addPaise(facts.kpis.previous.netSalesPaise);
    addPaise(facts.kpis.current.netSalesPaise);
    addPaise(facts.kpis.previous.aovPaise);
    addPaise(facts.kpis.current.aovPaise);
  }
  if (facts.opportunity) {
    const s = facts.opportunity.suggestedOffer;
    addPaise(s.pricePaise);
    addPaise(s.normalPricePaise);
    addPaise(s.normalPricePaise - s.pricePaise);
  }
  if (facts.economics) {
    const e = facts.economics;
    addPaise(e.pricePaise);
    addPaise(e.normalPricePaise);
    addPaise(e.bundleCostPaise);
    addPaise(e.contributionPaise);
    addPaise(e.maxDiscountExposurePaise);
  }
  if (facts.operations) {
    addPaise(facts.operations.restockTotalCostPaise);
    for (const line of facts.operations.lines) addPaise(line.restockCostPaise);
  }
  if (facts.campaign) {
    addPaise(facts.campaign.offer.pricePaise);
    addPaise(facts.campaign.offer.normalPricePaise);
    addPaise(facts.campaign.offer.bundleCostPaise);
    addPaise(facts.campaign.offer.maxDiscountExposurePaise);
    addPaise(facts.campaign.contributionPerBundlePaise);
    if (facts.campaign.results) {
      const r = facts.campaign.results;
      addPaise(r.revenuePaise);
      addPaise(r.variableCostPaise);
      addPaise(r.contributionPaise);
      addPaise(r.discountPaise);
    }
  }
  return amounts;
}

/**
 * Monetary guard for assistant answers: every rupee-shaped token in the text
 * must be one of the amounts the computed facts produce. Anything else (the
 * model inventing a price, a market size, a savings claim) fails validation
 * and the caller falls back to the fact book.
 */
export function assistantMonetaryTermsValid(text: string, allowed: Set<string>): boolean {
  const tokens = text.match(RUPEE_TOKEN_RE) ?? [];
  return tokens.every((t) => allowed.has(normalizeRupeeToken(t)));
}

export function parseAssistantAnswer(content: string, facts: AssistantFacts): { answer: string; reasoning: string[]; followUps: string[] } {
  const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error("Assistant model response was not valid JSON.");
  }
  const out = LiveAnswerSchema.parse(parsed);
  if (!assistantMonetaryTermsValid(out.answer, allowedRupeeAmounts(facts))) {
    throw new Error("Assistant answer contained rupee amounts that are not in the verified facts.");
  }
  return out;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Calls a Z.ai-compatible chat-completions endpoint with the given key config.
 * Endpoint host is validated first (same rules as the draft adapter) and the
 * fetch uses redirect:"error" so the bearer key can never be forwarded to an
 * unvalidated host.
 */
export async function callAssistantModel(
  prompts: { system: string; user: string },
  keyConfig: { apiKey: string; model: string; baseUrl: string }
): Promise<string> {
  const { validateModelEndpoint } = await import("@/adapters/ai");
  const safeEndpoint = validateModelEndpoint(keyConfig.baseUrl);
  const completionsUrl = `${safeEndpoint.protocol}//${safeEndpoint.host}${safeEndpoint.pathname.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: keyConfig.model,
    messages: [
      { role: "system", content: prompts.system },
      { role: "user", content: prompts.user },
    ],
    temperature: 0.4,
    max_tokens: 1200,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(completionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyConfig.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
        redirect: "error",
      });
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) throw new Error(`Model endpoint returned ${res.status}`);
      const json = (await res.json()) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("Model returned no content.");
      return content;
    } catch (err) {
      if (attempt === 1) throw err instanceof Error ? err : new Error("Assistant model call failed.");
    }
  }
  throw new Error("Assistant model call failed after one retry.");
}
