/**
 * SQLite access layer (better-sqlite3, Node server runtime only).
 *
 * - One connection per process, kept on globalThis so Next dev HMR reuses it.
 * - Schema is created idempotently on first open.
 * - All money is integer paise. All timestamps ISO 8601 UTC strings.
 * - Tenant scoping: every business table carries merchant_id and every query
 *   must filter by it (enforced in the service layer).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  demo_session_id TEXT NOT NULL,
  variant_seed INTEGER NOT NULL DEFAULT 20261106,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  fixture_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merchants_session ON merchants (demo_session_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','pending','canceled')),
  total_paise INTEGER NOT NULL,
  UNIQUE (merchant_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_time ON orders (merchant_id, occurred_at, status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL,
  unit_discount_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS inventory (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  sku_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_variable_cost_paise INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, sku_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  demo_channel_id TEXT NOT NULL,
  display_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','revoked','none')),
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (customer_id, channel)
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  fixture_version TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  values_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','queued')),
  opportunity_id TEXT NOT NULL,
  offer_json TEXT NOT NULL,
  copy_json TEXT NOT NULL,
  audience_hash TEXT NOT NULL,
  audience_count INTEGER NOT NULL,
  inventory_version INTEGER NOT NULL,
  metric_snapshot_id TEXT NOT NULL,
  preview_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ai_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_version INTEGER NOT NULL,
  approver_id TEXT NOT NULL,
  approved_payload_hash TEXT NOT NULL,
  approved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'simulated_queued',
  simulated INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, version, customer_id, channel)
);

CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, event_id)
);

CREATE TABLE IF NOT EXISTS idempotency_requests (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  redacted_details_json TEXT NOT NULL DEFAULT '{}'
);
`;

/**
 * Validates a configured database path before it touches the filesystem:
 * no control characters, no URL schemes, and the resolved location must stay
 * inside the project working directory (no ../ escapes). All shipped configs
 * (app server, seed CLI, fixture verifier, test runner) use project-relative
 * paths, so this changes no legitimate behaviour.
 */
export function resolveDatabasePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Database path is empty.");
  if (/[\0\r\n]/.test(trimmed)) throw new Error("Database path contains control characters.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new Error(`Database path must be a filesystem path, not a URL: ${trimmed}`);
  }
  const root = process.cwd();
  const resolved = path.resolve(root, trimmed);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(`Database path must stay inside the project directory (got ${resolved}).`);
  }
  return resolved;
}

export function openDatabase(dbPath: string): SqliteDatabase {
  const resolved = resolveDatabasePath(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  migrateLegacyMerchantsTable(db);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Databases created before multi-merchant support had UNIQUE(demo_session_id)
 * and no variant_seed column. SQLite cannot drop a unique constraint in place,
 * so if the old shape is detected the table is rebuilt (rows and children kept)
 * inside one transaction with foreign keys suspended.
 */
function migrateLegacyMerchantsTable(db: SqliteDatabase): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'merchants'").get() as
    | { sql: string }
    | undefined;
  if (!row || !row.sql.includes("UNIQUE")) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE merchants_migrated (
        id TEXT PRIMARY KEY,
        demo_session_id TEXT NOT NULL,
        variant_seed INTEGER NOT NULL DEFAULT 20261106,
        display_name TEXT NOT NULL,
        timezone TEXT NOT NULL,
        currency TEXT NOT NULL,
        fixture_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO merchants_migrated (id, demo_session_id, variant_seed, display_name, timezone, currency, fixture_version, created_at)
        SELECT id, demo_session_id, 20261106, display_name, timezone, currency, fixture_version, created_at FROM merchants;
      DROP TABLE merchants;
      ALTER TABLE merchants_migrated RENAME TO merchants;
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_merchants_session ON merchants (demo_session_id);");
  })();
}

/** Run `fn` inside an IMMEDIATE transaction; rolls back on throw. */
export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  // db.transaction().immediate() is better-sqlite3's native wrapper for
  // BEGIN IMMEDIATE ... COMMIT / ROLLBACK with identical semantics.
  return db.transaction(fn).immediate();
}

type GlobalWithDb = typeof globalThis & { __merchantSaathiDb?: SqliteDatabase };

/** Process-wide singleton used by route handlers. */
export function getDb(): SqliteDatabase {
  const g = globalThis as GlobalWithDb;
  if (!g.__merchantSaathiDb) {
    const dbPath = process.env.DATABASE_PATH?.trim() || "./data/merchant-saathi.sqlite";
    g.__merchantSaathiDb = openDatabase(dbPath);
  }
  return g.__merchantSaathiDb;
}
