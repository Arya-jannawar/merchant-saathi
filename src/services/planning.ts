/**
 * "My year" and tomorrow-forecast aggregation over the imported ledger.
 *
 * Definitions (on screen too): net sales = completed sales excluding tax,
 * after discounts and returns; gross profit = net sales minus the recorded
 * cost of those units ("costed lines"); gross margin = gross profit / net
 * sales where the denominator is positive. Rows without cost data never
 * count as zero cost - coverage is reported instead.
 */

import type { SqliteDatabase } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { forecastTomorrow, type TomorrowForecast } from "@/lib/forecast";
import { getNow } from "@/lib/clock";

export interface MonthBucket {
  month: string; // YYYY-MM
  label: string; // "Oct 2026"
  netSalesPaise: number;
  costedNetSalesPaise: number;
  grossProfitPaise: number; // only over costed lines
  grossMarginPct: number | null;
  tradingDays: number;
}

export interface YearReport {
  scope: "calendar" | "financial";
  yearLabel: string;
  months: MonthBucket[];
  highestSalesMonth: { month: string; label: string; netSalesPaise: number } | null;
  highestProfitMonth: { month: string; label: string; grossProfitPaise: number } | null;
  coverageNote: string | null;
  tieNote: string | null;
  totalNetSalesPaise: number;
  totalGrossProfitPaise: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Months in the requested scope, oldest first. Calendar = Jan..Dec of `year`; FY = Apr..Mar. */
function scopeMonths(scope: "calendar" | "financial", year: number): { month: string; label: string }[] {
  const out: { month: string; label: string }[] = [];
  if (scope === "calendar") {
    for (let m = 1; m <= 12; m++) out.push({ month: `${year}-${String(m).padStart(2, "0")}`, label: `${MONTH_LABELS[m - 1]} ${year}` });
  } else {
    for (let m = 4; m <= 12; m++) out.push({ month: `${year}-${String(m).padStart(2, "0")}`, label: `${MONTH_LABELS[m - 1]} ${year}` });
    for (let m = 1; m <= 3; m++) out.push({ month: `${year + 1}-${String(m).padStart(2, "0")}`, label: `${MONTH_LABELS[m - 1]} ${year + 1}` });
  }
  return out;
}

export async function yearReport(
  db: SqliteDatabase,
  merchantId: string,
  scope: "calendar" | "financial",
  year: number,
): Promise<YearReport> {
  // Month/day bucketing happens in IST (the app's business timezone): the
  // query applies the fixed +05:30 shift to the UTC ISO timestamps.
  const rows = (await db
    .prepare(
      `SELECT ((occurred_on::timestamp + interval '5 hours 30 minutes')::date::text) AS ist_day,
              substr(((occurred_on::timestamp + interval '5 hours 30 minutes')::date::text), 1, 7) AS month,
              SUM(CASE WHEN event_type = 'sale' THEN amount_paise ELSE 0 END)::int AS net_sales,
              SUM(CASE WHEN event_type = 'refund' THEN amount_paise ELSE 0 END)::int AS refunds,
              SUM(CASE WHEN event_type = 'sale' THEN COALESCE(units, 0) * COALESCE(unit_cost_paise, 0) ELSE 0 END)::int AS cogs,
              SUM(CASE WHEN event_type = 'sale' AND unit_cost_paise IS NOT NULL THEN amount_paise ELSE 0 END)::int AS costed_sales
       FROM ledger_events
       WHERE merchant_id = ? AND event_type IN ('sale','refund')
       GROUP BY ist_day`,
    )
    .all(merchantId)) as {
    ist_day: string;
    month: string;
    net_sales: number;
    refunds: number;
    cogs: number;
    costed_sales: number;
  }[];
  const byMonth = new Map<string, { net_sales: number; refunds: number; cogs: number; costed_sales: number; days: Set<string> }>();
  for (const r of rows) {
    const acc = byMonth.get(r.month) ?? { net_sales: 0, refunds: 0, cogs: 0, costed_sales: 0, days: new Set<string>() };
    acc.net_sales += r.net_sales;
    acc.refunds += r.refunds;
    acc.cogs += r.cogs;
    acc.costed_sales += r.costed_sales;
    acc.days.add(r.ist_day);
    byMonth.set(r.month, acc);
  }

  const months: MonthBucket[] = scopeMonths(scope, year).map(({ month, label }) => {
    const r = byMonth.get(month);
    const net = (r?.net_sales ?? 0) - (r?.refunds ?? 0);
    const costedSales = r?.costed_sales ?? 0;
    const grossProfit = net - (r?.cogs ?? 0);
    const marginPct = costedSales > 0 ? Math.round((grossProfit / costedSales) * 1000) / 10 : null;
    return {
      month,
      label,
      netSalesPaise: net,
      costedNetSalesPaise: costedSales,
      grossProfitPaise: grossProfit,
      grossMarginPct: marginPct,
      tradingDays: r?.days.size ?? 0,
    };
  });

  const withData = months.filter((m) => m.netSalesPaise > 0 || m.grossProfitPaise !== 0);
  if (withData.length === 0) {
    throw new ApiError(
      "business_rule",
      "No imported or recorded sales for this period yet - import a statement or record a day first.",
    );
  }

  const maxSales = Math.max(...months.map((m) => m.netSalesPaise));
  const salesWinners = months.filter((m) => m.netSalesPaise === maxSales && maxSales > 0);
  const maxProfit = Math.max(...months.map((m) => m.grossProfitPaise));
  const profitWinners = months.filter((m) => m.grossProfitPaise === maxProfit && maxProfit > 0);

  const costedTotal = months.reduce((s, m) => s + m.costedNetSalesPaise, 0);
  const coverageNote =
    costedTotal > 0
      ? `Gross profit covers ${(Math.round((costedTotal / Math.max(months.reduce((s, m) => s + m.netSalesPaise, 0), 1)) * 1000) / 10)}% of net sales (lines with recorded costs); uncosted lines never count as zero cost.`
      : "No recorded unit costs yet - import rows with a cost column to see gross profit.";

  return {
    scope,
    yearLabel: scope === "financial" ? `FY ${year}-${String(year + 1).slice(2)}` : String(year),
    months,
    highestSalesMonth:
      maxSales > 0
        ? { month: salesWinners[0].month, label: salesWinners.map((m) => m.label).join(" / "), netSalesPaise: maxSales }
        : null,
    highestProfitMonth:
      maxProfit > 0
        ? { month: profitWinners[0].month, label: profitWinners.map((m) => m.label).join(" / "), grossProfitPaise: maxProfit }
        : null,
    coverageNote,
    tieNote: salesWinners.length > 1 || profitWinners.length > 1 ? "Ties are shown together - no arbitrary winner." : null,
    totalNetSalesPaise: months.reduce((s, m) => s + m.netSalesPaise, 0),
    totalGrossProfitPaise: months.reduce((s, m) => s + m.grossProfitPaise, 0),
  };
}

/** Daily net sales (sale − refund) for the forecast target, IST local dates. */
export async function dailyNetSales(db: SqliteDatabase, merchantId: string): Promise<{ date: string; netPaise: number }[]> {
  const rows = (await db
    .prepare(
      `SELECT ((occurred_on::timestamp + interval '5 hours 30 minutes')::date::text) AS day,
              SUM(CASE WHEN event_type = 'sale' THEN amount_paise ELSE -amount_paise END)::int AS net
       FROM ledger_events
       WHERE merchant_id = ? AND event_type IN ('sale','refund')
       GROUP BY day ORDER BY day`,
    )
    .all(merchantId)) as { day: string; net: number }[];
  return rows.map((r) => ({ date: r.day, netPaise: r.net }));
}

/** Tomorrow forecast over the ledger, using the injected demo clock. */
export async function tomorrowForecast(db: SqliteDatabase, merchantId: string): Promise<TomorrowForecast & { businessName: string }> {
  const now = getNow();
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const business = (
    (await db.prepare("SELECT display_name FROM merchants WHERE id = ?").get(merchantId)) as { display_name: string } | undefined
  )?.display_name ?? "Your business";
  const forecast = forecastTomorrow(await dailyNetSales(db, merchantId), p);
  return { ...forecast, businessName: business };
}
