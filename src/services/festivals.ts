/**
 * Regional festival planner: a fixture calendar with stored sources and
 * check dates, deterministic ranking, and historical festival-window
 * comparisons computed from the imported ledger.
 *
 * Rules from the upgrade plan: past events never rank as upcoming; lead-time
 * deadlines are respected; conservative contribution = units x (price after
 * discount - unit cost - incremental variable) - fixed campaign cost, with
 * the incremental-demand assumption called out; sparse history gets a
 * labeled low-cost trial suggestion.
 */

import type { SqliteDatabase } from "@/lib/db";
import { getNow, istParts } from "@/lib/clock";
import { dailyNetSales } from "@/services/planning";

export interface FestivalCalendarEntry {
  id: string;
  name: string;
  date: string; // local calendar date, YYYY-MM-DD
  region: string;
  source: string;
  status: "official notification" | "public holiday (fixed date) - confirm local relevance" | "date needs confirmation";
  checkedOn: string;
  /** Last year's occurrence (ledger rows tagged with its window tag feed the comparison). */
  historicalDate: string | null;
}

/**
 * Fixture calendar. Diwali Amavasya 2026 is sourced from the Maharashtra
 * government notification (public holiday list PDF, checked 2026-11-06 for
 * the fixture clock). Fixed-date holidays are flagged for local confirmation.
 */
export const FESTIVAL_CALENDAR: FestivalCalendarEntry[] = [
  {
    id: "diwali-amavasya-2026",
    name: "Diwali Amavasya (Laxmi Pujan)",
    date: "2026-11-08",
    region: "Maharashtra",
    source: "https://maharashtra.gov.in/site/Upload/pdf/Public-Holiday-2026.pdf",
    status: "official notification",
    checkedOn: "2026-11-06",
    historicalDate: "2025-10-20", // tagged "diwali-week-2025" window in the kiosk sample
  },
  {
    id: "christmas-2026",
    name: "Christmas",
    date: "2026-12-25",
    region: "national",
    source: "https://www.india.gov.in/calendar",
    status: "public holiday (fixed date) - confirm local relevance",
    checkedOn: "2026-11-06",
    historicalDate: null,
  },
  {
    id: "makar-sankranti-2027",
    name: "Makar Sankranti",
    date: "2027-01-14",
    region: "national (western states)",
    source: "https://www.india.gov.in/calendar",
    status: "public holiday (fixed date) - confirm local relevance",
    checkedOn: "2026-11-06",
    historicalDate: null,
  },
];

export interface FestivalOpportunity {
  festival: FestivalCalendarEntry;
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
    confidence: "comparable weeks matched" | "sparse history";
  } | null;
  suggestion: string;
  estimatedContributionPaise: number | null;
}

interface LedgerWindow {
  netPaise: number;
  costPaise: number;
  units: number;
}

function windowStats(db: SqliteDatabase, merchantId: string, startDate: string, days: number, tag: string | null): LedgerWindow {
  const endExclusive = new Date(startDate + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + days);
  const rows = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN event_type = 'sale' THEN amount_paise ELSE -amount_paise END), 0) AS net,
              COALESCE(SUM(units * COALESCE(unit_cost_paise, 0)), 0) AS cost,
              COALESCE(SUM(units), 0) AS units
       FROM ledger_events
       WHERE merchant_id = ? AND event_type IN ('sale','refund')
         AND date(occurred_on, '+5 hours', '+30 minutes') >= ? AND date(occurred_on, '+5 hours', '+30 minutes') < ?
         ${tag ? "AND note = ?" : ""}`,
    )
    .all(merchantId, startDate, endExclusive.toISOString().slice(0, 10), ...(tag ? [tag] : [])) as { net: number; cost: number; units: number }[];
  return { netPaise: rows[0]?.net ?? 0, costPaise: rows[0]?.cost ?? 0, units: rows[0]?.units ?? 0 };
}

/**
 * Historical comparison: last year's calendar occurrence of this festival vs
 * complete nearby windows that do not overlap the festival window itself.
 */
function historicalComparison(db: SqliteDatabase, merchantId: string, historicalDate: string, days: number) {
  const historical = windowStats(db, merchantId, historicalDate, days, null);
  if (historical.netPaise === 0) return null;
  const historicalStart = new Date(historicalDate + "T00:00:00Z").getTime();
  const historicalEnd = historicalStart + days * 86_400_000;
  const base = dailyNetSales(db, merchantId).filter((d) => {
    const t = new Date(d.date + "T00:00:00Z").getTime();
    return t >= historicalStart - 90 * 86_400_000 && t <= historicalEnd + 30 * 86_400_000;
  });
  const allDays = new Set(base.map((d) => d.date));
  const comparable: LedgerWindow[] = [];
  for (const d of base) {
    // A window is comparable only when it is COMPLETE (all days have rows) and
    // does not overlap the historical festival window itself.
    let complete = true;
    for (let i = 0; i < days && complete; i++) {
      const day = new Date(d.date + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + i);
      if (!allDays.has(day.toISOString().slice(0, 10))) complete = false;
    }
    const windowStart = new Date(d.date + "T00:00:00Z").getTime();
    const windowEnd = windowStart + days * 86_400_000;
    if (windowStart < historicalEnd && windowEnd > historicalStart) complete = false;
    if (!complete) continue;
    const stats = windowStats(db, merchantId, d.date, days, null);
    if (stats.netPaise > 0) comparable.push(stats);
  }
  if (comparable.length < 2) {
    return {
      comparableWeeks: comparable.length,
      comparableAvgNetPaise: historical.netPaise,
      festivalWeekNetPaise: historical.netPaise,
      salesChangePct: null,
      comparableAvgProfitPaise: historical.netPaise - historical.costPaise,
      festivalWeekProfitPaise: historical.netPaise - historical.costPaise,
      profitChangePaise: null,
      confidence: "sparse history" as const,
    };
  }
  const avgNet = Math.round(comparable.reduce((s, w) => s + w.netPaise, 0) / comparable.length);
  const avgProfit = Math.round(comparable.reduce((s, w) => s + (w.netPaise - w.costPaise), 0) / comparable.length);
  const festivalProfit = historical.netPaise - historical.costPaise;
  return {
    comparableWeeks: comparable.length,
    comparableAvgNetPaise: avgNet,
    festivalWeekNetPaise: historical.netPaise,
    salesChangePct: avgNet > 0 ? Math.round(((historical.netPaise - avgNet) / avgNet) * 1000) / 10 : null,
    comparableAvgProfitPaise: avgProfit,
    festivalWeekProfitPaise: festivalProfit,
    profitChangePaise: festivalProfit - avgProfit,
    confidence: "comparable weeks matched" as const,
  };
}

export function festivalPlan(db: SqliteDatabase, merchantId: string, opts: { prepDays: number; objective: "profit" | "trials"; budgetPaise: number | null }): {
  asOf: string;
  region: string;
  opportunities: FestivalOpportunity[];
} {
  const now = getNow();
  const parts = istParts(now);
  const todayLocal = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const daysAway = (festivalDate: string) =>
    Math.round((new Date(festivalDate + "T00:00:00Z").getTime() - new Date(todayLocal + "T00:00:00Z").getTime()) / 86_400_000);

  const opportunities: FestivalOpportunity[] = [];
  for (const festival of FESTIVAL_CALENDAR) {
    const away = daysAway(festival.date);
    if (away < 0) continue; // past events never rank as upcoming
    const leadTimeDays = Math.max(opts.prepDays, 1);
    const deadlinePassed = away < leadTimeDays;
    const historical = festival.historicalDate
      ? historicalComparison(db, merchantId, festival.historicalDate, 7)
      : null;

    let suggestion: string;
    let estimated: number | null = null;
    if (deadlinePassed) {
      suggestion = `Deadline passed: this festival needs ${leadTimeDays} prep day(s) and it is ${away} day(s) away. Plan the next one.`;
    } else if (historical && historical.salesChangePct !== null && historical.salesChangePct > 0 && (historical.profitChangePaise ?? 0) < 0) {
      suggestion =
        "Last comparable week lifted sales but cut gross profit (deeper discount + higher cost). Test preorders or a smaller discount before committing stock.";
      estimated = historical.festivalWeekProfitPaise; // conservative: repeat last profit
    } else if (historical && historical.confidence === "comparable weeks matched") {
      suggestion = "History supports a capped festival offer. Keep the cap inside stock and set the discount to protect the margin floor.";
      estimated = historical.festivalWeekProfitPaise > 0 ? historical.festivalWeekProfitPaise : null;
    } else {
      suggestion = "No usable comparable week in the ledger - a small, clearly capped trial is the honest first step (labeled hypothesis).";
    }
    opportunities.push({
      festival,
      daysAway: away,
      leadTimeDays,
      deadlinePassed,
      deadlineLabel: deadlinePassed ? `prep deadline was ${away === 0 ? "today" : `${leadTimeDays - away} day(s) ago`}` : `prepare by ${festival.date}`,
      historical,
      suggestion,
      estimatedContributionPaise: opts.objective === "profit" ? estimated : null,
    });
  }

  // Deterministic order: feasible first, then the stated objective, then
  // historical evidence, then the nearest deadline.
  opportunities.sort((a, b) => {
    if (a.deadlinePassed !== b.deadlinePassed) return a.deadlinePassed ? 1 : -1;
    const aScore = a.estimatedContributionPaise ?? -1;
    const bScore = b.estimatedContributionPaise ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return a.daysAway - b.daysAway;
  });

  return { asOf: todayLocal, region: "Pune, Maharashtra (fixture region - editable per business)", opportunities: opportunities.slice(0, 3) };
}
