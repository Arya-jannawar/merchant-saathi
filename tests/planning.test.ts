// Acceptance tests for "Plan my next sale" - the numbers come straight from
// the upgrade plan's verification list, so the journey cannot drift.
import { beforeAll, describe, expect, it } from "vitest";
import { parseStatement, parseAmountToPaise, parseDateToIso } from "@/lib/import-parse";
import { forecastTomorrow, backtestMetrics } from "@/lib/forecast";
import { yearReport } from "@/services/planning";
import { openDatabase, resolveDatabasePath, type SqliteDatabase } from "@/lib/db";
import { confirmImport, previewImport } from "@/services/imports";
import { festivalPlan } from "@/services/festivals";

function makeDb(name: string, merchants: string[] = ["mrc_test", "mrc_a", "mrc_b"]): SqliteDatabase {
  const db = openDatabase(`./data/test-${name}.sqlite`);
  const insert = db.prepare(
    "INSERT INTO merchants (id, demo_session_id, variant_seed, display_name, timezone, currency, fixture_version, created_at) VALUES (?, ?, 1, ?, 'Asia/Kolkata', 'INR', 'bakery-v1', '2026-11-06T13:30:00.000Z')",
  );
  db.transaction(() => {
    for (const id of merchants) insert.run(id, `sess-${id}`, id);
  })();
  return db;
}

const AFTERNOON_CSV = [
  "Date,Time,Type,Amount,Method",
  "2026-11-05,15:00,Sale,125.50,UPI",
  "2026-11-05,17:59,Sale,74.50,Cash",
  "2026-11-05,18:00,Sale,80,UPI",
  "2026-11-05,16:10,Cancelled,-50,UPI",
].join("\n");

describe("import pipeline", () => {
  it("day totals, afternoon window (15:00 inclusive, 18:00 exclusive) and cancelled rows work", () => {
    const db = makeDb("import-afternoon");
    const preview = previewImport(db, "mrc_test", "afternoon.csv", AFTERNOON_CSV, "auto");
    expect(preview.rowsImported).toBe(3);
    expect(preview.rows.filter((r) => r.status === "skip-cancelled")).toHaveLength(1);

    const receipt = confirmImport(db, "mrc_test", "afternoon.csv", AFTERNOON_CSV, "auto");
    expect(receipt.rowsImported).toBe(3);

    const day = db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM ledger_events WHERE event_type = 'sale'")
      .get() as { n: number };
    expect(day.n).toBe(28000); // ₹280 for the day

    const afternoon = db
      .prepare(
        "SELECT COALESCE(SUM(amount_paise), 0) AS n, COUNT(*) AS c FROM ledger_events WHERE event_type = 'sale' AND cast(strftime('%H', occurred_on, '+5 hours', '+30 minutes') AS INTEGER) >= 15 AND cast(strftime('%H', occurred_on, '+5 hours', '+30 minutes') AS INTEGER) < 18",
      )
      .get() as { n: number; c: number };
    expect(afternoon.n).toBe(20000); // ₹200 across two afternoon sales
    expect(afternoon.c).toBe(2);
  });

  it("an exact-file retry is a no-op and a different file with the same rows is deduped", () => {
    const db = makeDb("import-dedupe");
    const first = confirmImport(db, "mrc_test", "a.csv", AFTERNOON_CSV, "auto");
    expect(first.rowsImported).toBe(3);
    const retry = confirmImport(db, "mrc_test", "a.csv", AFTERNOON_CSV, "auto");
    expect(retry.duplicateBatch).toBe(true);
    expect(retry.rowsImported).toBe(0);
    const total = db.prepare("SELECT COUNT(*) AS n FROM ledger_events").get() as { n: number };
    expect(total.n).toBe(3);
  });

  it("amount parsing handles Indian grouping, rupee sign, accounting negatives", () => {
    expect(parseAmountToPaise("1,25,000.50")).toBe(12500050);
    expect(parseAmountToPaise("₹125.50")).toBe(12550);
    expect(parseAmountToPaise("Rs 74.5")).toBe(7450);
    expect(parseAmountToPaise("-50")).toBe(-5000);
    expect(parseAmountToPaise("(125.50)")).toBe(-12550);
    expect(parseAmountToPaise("")).toBeNull();
  });

  it("a stale business selection never writes to another business", () => {
    const db = makeDb("import-tenant");
    confirmImport(db, "mrc_a", "a.csv", AFTERNOON_CSV, "auto");
    confirmImport(db, "mrc_b", "b.csv", AFTERNOON_CSV, "auto");
    const rows = db
      .prepare("SELECT merchant_id, COUNT(*) AS n FROM ledger_events GROUP BY merchant_id")
      .all() as { merchant_id: string; n: number }[];
    expect(rows).toEqual([
      { merchant_id: "mrc_a", n: 3 },
      { merchant_id: "mrc_b", n: 3 },
    ]);
  });
});

describe("My year (annual fixture)", () => {
  const db = makeDb("year-annual", ["mrc_year"]);

  // Seed the ledger directly with the annual fixture's EXACT monthly totals.
  const MONTHS: { y: number; m: number; net: number; cost: number }[] = [
    { y: 2025, m: 11, net: 48000, cost: 33600 },
    { y: 2025, m: 12, net: 55000, cost: 38500 },
    { y: 2026, m: 1, net: 42000, cost: 29400 },
    { y: 2026, m: 2, net: 44000, cost: 30800 },
    { y: 2026, m: 3, net: 50000, cost: 35000 },
    { y: 2026, m: 4, net: 46000, cost: 32200 },
    { y: 2026, m: 5, net: 52000, cost: 36400 },
    { y: 2026, m: 6, net: 40000, cost: 28000 },
    { y: 2026, m: 7, net: 45000, cost: 31500 },
    { y: 2026, m: 8, net: 58000, cost: 40600 },
    { y: 2026, m: 9, net: 65000, cost: 40000 },
    { y: 2026, m: 10, net: 80000, cost: 62000 },
  ];
  beforeAll(() => {
    const insert = db.prepare(
      "INSERT INTO ledger_events (id, merchant_id, batch_id, event_type, occurred_on, amount_paise, units, unit_cost_paise, source, fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    db.transaction(() => {
      MONTHS.forEach((month, mi) => {
        // Two rows per month keeps the fixture small: one costed sale row split
        // across two days, exact to the month totals.
        insert.run(
          `led_y${mi}a`, "mrc_year", "batch-fixtures", "sale", `${month.y}-${String(month.m).padStart(2, "0")}-10T10:00:00.000Z`,
          Math.round(month.net / 2) * 100, 1, Math.round(month.cost / 2) * 100, "import", `y${mi}a`, "2026-11-06T00:00:00.000Z",
        );
        insert.run(
          `led_y${mi}b`, "mrc_year", "batch-fixtures", "sale", `${month.y}-${String(month.m).padStart(2, "0")}-20T10:00:00.000Z`,
          (month.net - Math.round(month.net / 2)) * 100, 1, (month.cost - Math.round(month.cost / 2)) * 100, "import", `y${mi}b`, "2026-11-06T00:00:00.000Z",
        );
      });
    })();
  });

  it("returns October for highest sales and September for highest gross profit", () => {
    const report = yearReport(db, "mrc_year", "calendar", 2026);
    expect(report.highestSalesMonth?.month).toBe("2026-10");
    expect(report.highestSalesMonth?.netSalesPaise).toBe(8000000);
    expect(report.highestProfitMonth?.month).toBe("2026-09");
    expect(report.highestProfitMonth?.grossProfitPaise).toBe(2500000);
    expect(report.months.find((m) => m.month === "2026-09")?.grossMarginPct).not.toBeNull();
  });

  it("labels coverage instead of counting uncosted lines as zero cost", () => {
    const report = yearReport(db, "mrc_year", "calendar", 2026);
    expect(report.coverageNote).toContain("recorded costs");
  });
});

describe("Tomorrow forecast", () => {
  it("matches the plan's MAE/WAPE acceptance on the three-day example", () => {
    // The plan's example: actual [100,120,80], ridge [90,130,80],
    // seasonal [80,100,80] -> MAE Rs 6.67 vs Rs 13.33, WAPE 6.67% vs 13.33%
    // (WAPE here = MAE / mean(|actual|), the definition the acceptance uses).
    const predictions = [
      { date: "d1", predictedRupees: 90, actualRupees: 100 },
      { date: "d2", predictedRupees: 130, actualRupees: 120 },
      { date: "d3", predictedRupees: 80, actualRupees: 80 },
    ];
    const ridge = backtestMetrics(predictions);
    const seasonal = backtestMetrics([
      { date: "d1", predictedRupees: 80, actualRupees: 100 },
      { date: "d2", predictedRupees: 100, actualRupees: 120 },
      { date: "d3", predictedRupees: 80, actualRupees: 80 },
    ]);
    expect(ridge.maeRupees).toBe(6.67);
    expect(ridge.wapePct).toBe(6.67);
    expect(seasonal.maeRupees).toBe(13.33);
    expect(seasonal.wapePct).toBe(13.33);
  });

  it("selects the simpler seasonal baseline on an exact weekly pattern", () => {
    // A perfectly repeating weekly pattern: the naive baseline predicts it
    // exactly, so the simpler model must win the selection.
    const series: { date: string; netPaise: number }[] = [];
    const pattern = [100, 140, 120, 90, 110, 180, 160]; // Sun..Sat, in rupees
    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(2025, 10, 2) + i * 86_400_000).toISOString().slice(0, 10);
      series.push({ date: d, netPaise: pattern[new Date(d + "T00:00:00Z").getUTCDay()] * 100 });
    }
    const result = forecastTomorrow(series, series.at(-1)!.date);
    expect(result.usable).toBe(true);
    expect(result.baseline!.maeRupees).toBe(0);
    expect(result.selectedModel).toBe("seasonal-naive");
    expect(result.predictedRupees).toBe(pattern[new Date(result.tomorrowDate + "T00:00:00Z").getUTCDay()]);
  });

  it("refuses to forecast on thin history with an honest reason", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      netPaise: 50_000,
    }));
    const result = forecastTomorrow(series, "2026-01-10");
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("consecutive trading days");
  });
});

describe("Festival planner", () => {
  const db = makeDb("festival-kiosk", ["mrc_kiosk"]);
  beforeAll(() => {
    // The kiosk worked example: complete Mon-Sun weeks. Ordinary weeks are
    // exactly 200 units @ Rs 50, cost Rs 30 (Rs 10,000 net / Rs 4,000 profit).
    // The tagged diwali week: 300 units @ Rs 45, cost Rs 32 (Rs 13,500 / Rs 3,900).
    const insert = db.prepare(
      "INSERT INTO ledger_events (id, merchant_id, batch_id, event_type, occurred_on, amount_paise, units, unit_cost_paise, note, source, fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    db.transaction(() => {
      const start = new Date("2025-09-01T00:00:00Z"); // Monday
      for (let week = 0; week < 11; week++) {
        const isFestival = week === 7;
        for (let day = 0; day < 7; day++) {
          const date = new Date(start.getTime() + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10);
          const units = isFestival ? [40, 44, 41, 43, 45, 44, 43][day] : [28, 29, 28, 29, 28, 29, 29][day];
          const price = isFestival ? 45 : 50;
          const cost = isFestival ? 32 : 30;
          insert.run(
            `led_f${week}_${day}`, "mrc_kiosk", "batch-kiosk", "sale", `${date}T10:00:00.000Z`,
            units * price * 100, units, cost * 100, isFestival ? "diwali-week-2025" : "counter sale",
            "import", `f${week}_${day}`, "2026-11-06T00:00:00.000Z",
          );
        }
      }
    })();
  });

  it("returns +35% sales and -Rs 100 gross profit for the tagged festival week", () => {
    const plan = festivalPlan(db, "mrc_kiosk", { prepDays: 1, objective: "profit", budgetPaise: null });
    const diwali = plan.opportunities.find((o) => o.festival.id === "diwali-amavasya-2026");
    expect(diwali).toBeDefined();
    expect(diwali!.historical).not.toBeNull();
    expect(diwali!.historical!.salesChangePct).toBe(35);
    expect(diwali!.historical!.profitChangePaise).toBe(-10000); // -Rs 100 in paise
    expect(diwali!.historical!.confidence).toBe("comparable weeks matched");
    expect(diwali!.suggestion).toContain("preorders or a smaller discount");
  });

  it("never ranks a past festival as upcoming and respects lead times", () => {
    const plan = festivalPlan(db, "mrc_kiosk", { prepDays: 1, objective: "profit", budgetPaise: null });
    // Demo clock: Fri 6 Nov 2026 -> Diwali (8 Nov) is 2 days away and feasible
    // with 1 prep day; the whole list contains only future dates.
    for (const op of plan.opportunities) {
      expect(op.daysAway).toBeGreaterThanOrEqual(0);
    }
    const diwali = plan.opportunities.find((o) => o.festival.id === "diwali-amavasya-2026")!;
    expect(diwali.daysAway).toBe(2);
    expect(diwali.deadlinePassed).toBe(false);
    // A 5-day prep rule makes the Diwali deadline pass.
    const late = festivalPlan(db, "mrc_kiosk", { prepDays: 5, objective: "profit", budgetPaise: null });
    const lateDiwali = late.opportunities.find((o) => o.festival.id === "diwali-amavasya-2026")!;
    expect(lateDiwali.deadlinePassed).toBe(true);
    expect(lateDiwali.suggestion).toContain("Deadline passed");
  });
});
