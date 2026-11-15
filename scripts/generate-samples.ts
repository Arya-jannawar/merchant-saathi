/**
 * Deterministic sample-statement generator for "Plan my next sale".
 *
 * Writes three CSVs into public/samples/:
 *  - template-import.csv       small template: sale, payment, refund, fee, cancelled rows
 *  - sample-annual-bakery.csv  365 trading days (Nov 2025 -> Oct 2026); monthly net/cost
 *                              totals are EXACT: Oct 2026 net Rs 80,000 (cost 62,000) is the
 *                              sales peak; Sep 2026 profit Rs 25,000 (65,000 - 40,000) is the
 *                              gross-profit peak; every other month is below both.
 *  - sample-festival-kiosk.csv complete Mon-Sun weeks (Sep-Nov 2025): ordinary weeks are
 *                              exactly 200 units @ Rs 50 with Rs 30 unit cost (Rs 10,000 net /
 *                              Rs 4,000 profit per week); the tagged "diwali-week-2025" week is
 *                              300 units @ Rs 45 with Rs 32 unit cost (Rs 13,500 / Rs 3,900) -
 *                              +35% sales, -Rs 100 gross profit.
 *
 * The generator is seeded, so re-running it reproduces the same files.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// mulberry32 - tiny deterministic PRNG (same algorithm as src/lib/seed.ts).
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysOfMonth(year: number, month: number): number {
  return month === 2 && year % 4 === 0 ? 29 : DAYS_IN_MONTH[month - 1];
}

function csvLine(cells: (string | number)[]): string {
  return cells.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(",");
}

function monthDays(year: number, month: number): string[] {
  const out: string[] = [];
  for (let d = 1; d <= daysOfMonth(year, month); d++) {
    out.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function distribute(total: number, days: string[], rand: () => number, weekendUplift: number): number[] {
  // Base share per day with a weekend uplift and +-8% noise; the last day is
  // the residual so the month total is exact in integer rupees.
  const raw = days.map((d) => {
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    const weekend = dow === 0 || dow === 6 ? weekendUplift : 0.9;
    return (total / days.length) * weekend * (0.92 + rand() * 0.16);
  });
  const rounded = raw.map((v) => Math.max(Math.round(v), 1));
  const residual = total - rounded.slice(0, -1).reduce((s, v) => s + v, 0);
  rounded[rounded.length - 1] = Math.max(residual, 1);
  return rounded;
}

const HEAD = "Date,Time,Type,Amount,Method,Note,Units,Unit Cost";

function annualRows(): string[] {
  const rand = mulberry32(20261106);
  const months: { year: number; month: number; net: number; cost: number }[] = [
    { year: 2025, month: 11, net: 48000, cost: 33600 },
    { year: 2025, month: 12, net: 55000, cost: 38500 },
    { year: 2026, month: 1, net: 42000, cost: 29400 },
    { year: 2026, month: 2, net: 44000, cost: 30800 },
    { year: 2026, month: 3, net: 50000, cost: 35000 },
    { year: 2026, month: 4, net: 46000, cost: 32200 },
    { year: 2026, month: 5, net: 52000, cost: 36400 },
    { year: 2026, month: 6, net: 40000, cost: 28000 },
    { year: 2026, month: 7, net: 45000, cost: 31500 },
    { year: 2026, month: 8, net: 58000, cost: 40600 },
    { year: 2026, month: 9, net: 65000, cost: 40000 },
    { year: 2026, month: 10, net: 80000, cost: 62000 },
  ];
  const lines: string[] = [HEAD];
  for (const { year, month, net, cost } of months) {
    const days = monthDays(year, month);
    const nets = distribute(net, days, rand, 1.3);
    const costs = distribute(cost, days, rand, 1.15);
    days.forEach((date, i) => {
      const dow = new Date(date + "T00:00:00Z").getUTCDay();
      const time = dow === 0 ? "12:30" : "16:45";
      const method = i % 3 === 0 ? "Cash" : "UPI";
      lines.push(csvLine([date, time, "Sale", nets[i], method, "counter sale", 1, costs[i]]));
    });
  }
  return lines;
}

function kioskRows(): string[] {
  // Complete Mon-Sun weeks. Ordinary week: units [28,29,28,29,28,29,29] = 200
  // units @ Rs 50, cost Rs 30 -> Rs 10,000 net / Rs 4,000 profit. Festival
  // week (tagged diwali-week-2025): units [40,44,41,43,45,44,43] = 300 @ Rs 45,
  // cost Rs 32 -> Rs 13,500 net / Rs 3,900 profit.
  const ordinaryUnits = [28, 29, 28, 29, 28, 29, 29];
  const festivalUnits = [40, 44, 41, 43, 45, 44, 43];
  const lines: string[] = [HEAD];
  const start = new Date("2025-09-01T00:00:00Z"); // a Monday
  for (let week = 0; week < 11; week++) {
    const isFestival = week === 7; // Mon 2025-10-20 .. Sun 2025-10-26
    for (let day = 0; day < 7; day++) {
      const d = new Date(start.getTime() + (week * 7 + day) * 86_400_000);
      const date = d.toISOString().slice(0, 10);
      const units = isFestival ? festivalUnits[day] : ordinaryUnits[day];
      const price = isFestival ? 45 : 50;
      const cost = isFestival ? 32 : 30;
      const method = day % 2 === 0 ? "UPI" : "Cash";
      lines.push(csvLine([date, "17:10", "Sale", units * price, method, isFestival ? "diwali-week-2025" : "counter sale", units, cost]));
    }
  }
  return lines;
}

function templateRows(): string[] {
  return [
    HEAD,
    csvLine(["2026-11-06", "15:00", "Sale", 125.5, "UPI", "counter sale", 1, 0]),
    csvLine(["2026-11-06", "17:59", "Sale", 74.5, "Cash", "counter sale", 1, 0]),
    csvLine(["2026-11-06", "18:00", "Sale", 80, "UPI", "after-hours order", 1, 0]),
    csvLine(["2026-11-06", "16:10", "Cancelled", -50, "UPI", "customer cancelled", 1, 0]),
    csvLine(["2026-11-06", "19:05", "Payment", 300, "UPI", "deposit for cake order", "", ""]),
    csvLine(["2026-11-07", "10:00", "Refund", -60, "UPI", "refund for stale stock", "", ""]),
    csvLine(["2026-11-07", "10:05", "Fee", 12.3, "", "platform fee", "", ""]),
  ];
}

function main() {
  const outDir = path.join(process.cwd(), "public", "samples");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "sample-annual-bakery.csv"), annualRows().join("\n") + "\n");
  writeFileSync(path.join(outDir, "sample-festival-kiosk.csv"), kioskRows().join("\n") + "\n");
  writeFileSync(path.join(outDir, "template-import.csv"), templateRows().join("\n") + "\n");
  console.log("[samples] wrote template-import.csv, sample-annual-bakery.csv, sample-festival-kiosk.csv");
}

main();
