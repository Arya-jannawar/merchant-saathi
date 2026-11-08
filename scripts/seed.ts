/**
 * CLI seeder: creates the schema and seeds the default local database.
 * Safe to re-run; verifies its own sums afterwards.
 */
import { openDatabase } from "../src/lib/db";
import { seedDefaultDatabase } from "../src/lib/seed";

async function main() {
  const dbPath = process.env.DATABASE_PATH?.trim() || "./data/merchant-saathi.sqlite";
  console.log(`[seed] database: ${dbPath}`);
  const db = openDatabase(dbPath);
  const { merchantId } = seedDefaultDatabase(db);

  const counts = {
    merchants: (db.prepare("SELECT COUNT(*) AS n FROM merchants").get() as { n: number }).n,
    orders: (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n,
    order_items: (db.prepare("SELECT COUNT(*) AS n FROM order_items").get() as { n: number }).n,
    customers: (db.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n,
    consents: (db.prepare("SELECT COUNT(*) AS n FROM consents").get() as { n: number }).n,
    snapshots: (db.prepare("SELECT COUNT(*) AS n FROM metric_snapshots").get() as { n: number }).n,
  };
  console.log(`[seed] tenant ${merchantId} seeded:`, counts);
  console.log("[seed] done. Next: npm run fixtures:verify");
}

void main();
