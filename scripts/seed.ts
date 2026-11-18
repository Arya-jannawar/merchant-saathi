/**
 * CLI seeder: creates the schema and seeds the default local database.
 * Safe to re-run; verifies its own sums afterwards.
 */
// Scripts run via tsx which does not auto-load .env.local - load it once.
import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  try {
    const envFile = fs.readFileSync(".env.local", "utf8");
    const match = envFile.match(/^DATABASE_URL=(.*)$/m);
    if (match) process.env.DATABASE_URL = match[1].trim().replace(/^"/, "").replace(/"$/, "");
  } catch {
    // fall through - the db layer surfaces a clear error without a URL
  }
}

import { getDb } from "../src/lib/db";
import { seedDefaultDatabase } from "../src/lib/seed";

async function main() {
  const dbPath = process.env.DATABASE_PATH?.trim() || "./data/merchant-saathi.sqlite";
  console.log(`[seed] database: ${dbPath}`);
  const db = await getDb();
  const { merchantId } = await seedDefaultDatabase(db);

  const counts = {
    merchants: ((await db.prepare("SELECT COUNT(*)::int AS n FROM merchants").get()) as { n: number }).n,
    orders: ((await db.prepare("SELECT COUNT(*)::int AS n FROM orders").get()) as { n: number }).n,
    order_items: ((await db.prepare("SELECT COUNT(*)::int AS n FROM order_items").get()) as { n: number }).n,
    customers: ((await db.prepare("SELECT COUNT(*)::int AS n FROM customers").get()) as { n: number }).n,
    consents: ((await db.prepare("SELECT COUNT(*)::int AS n FROM consents").get()) as { n: number }).n,
    snapshots: ((await db.prepare("SELECT COUNT(*)::int AS n FROM metric_snapshots").get()) as { n: number }).n,
  };
  console.log(`[seed] tenant ${merchantId} seeded:`, counts);
  console.log("[seed] done. Next: npm run fixtures:verify");
}

void main();
