/**
 * Postgres access layer (postgres.js over a hosted Postgres, server runtime only).
 *
 * Ported from better-sqlite3 so the app can run on serverless hosts (Vercel):
 * - One lazy singleton per process, kept on globalThis so Next dev HMR reuses it.
 *   Queries go through `db.prepare(sql).get/all/run(...)` exactly as before - the
 *   helpers are async now and every call site awaits them.
 * - Schema is created idempotently on first open; the app owns its schema.
 * - All money is integer paise. All timestamps ISO 8601 UTC strings.
 * - Tenant scoping: every business table carries merchant_id and every query
 *   must filter by it (enforced in the service layer).
 *
 * Transactions: `withTransaction` reserves a dedicated connection (postgres.js
 * `reserve()`), runs BEGIN/COMMIT around the callback, and exposes the reserved
 * connection to the callback's `prepare()` calls through AsyncLocalStorage -
 * so transaction bodies keep reading and writing through the same helper.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import postgres from "postgres";

/** The query-builder returned by `db.prepare(sql)` - awaited by every call site. */
export interface Prepared {
  // Typed `any` (not Promise<any>) so the historical call-site style -
  // `(...).get(...) as { n: number }` - stays valid at any position relative
  // to `await` (TS binds `as` tighter than `await`); callers narrow with `as`.
  get(...args: unknown[]): any;
  all(...args: unknown[]): any;
  run(...args: unknown[]): Promise<RunResult>;
}

/**
 * The database handle the services pass around. It mirrors the old
 * better-sqlite3 call shape (`db.prepare(sql).get/all/run(...)`) over async
 * Postgres, plus a raw `unsafe` for schema/bootstrap statements.
 */
export interface SqliteDatabase {
  prepare(text: string): Prepared;
  unsafe(text: string, args?: unknown[]): Promise<Record<string, unknown>[] & { count?: number }>;
  reserve(): Promise<{ sql: SqliteDatabase; release: () => void }>;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** Static schema statements, run in order on first open. Never interpolated. */
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    demo_session_id TEXT NOT NULL,
    variant_seed INTEGER NOT NULL DEFAULT 20261106,
    display_name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    currency TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_merchants_session ON merchants (demo_session_id)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed','pending','canceled')),
    total_paise INTEGER NOT NULL,
    UNIQUE (merchant_id, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_merchant_time ON orders (merchant_id, occurred_at, status)`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sku_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_paise INTEGER NOT NULL,
    unit_discount_paise INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id)`,
  `CREATE TABLE IF NOT EXISTS inventory (
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sku_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    unit_variable_cost_paise INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (merchant_id, sku_id)
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    demo_channel_id TEXT NOT NULL,
    display_label TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','revoked','none')),
    captured_at TEXT NOT NULL,
    source TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (customer_id, channel)
  )`,
  `CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    fixture_version TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    definition_version TEXT NOT NULL,
    values_json TEXT NOT NULL,
    computed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
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
  )`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    campaign_version INTEGER NOT NULL,
    approver_id TEXT NOT NULL,
    approved_payload_hash TEXT NOT NULL,
    approved_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outbox (
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
  )`,
  `CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (campaign_id, event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_requests (
    key TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    redacted_details_json TEXT NOT NULL DEFAULT '{}'
  )`,
  // Normalized transaction ledger for imported files ("Plan my next sale").
  // One row per classified event; amounts in integer paise; provenance kept.
  `CREATE TABLE IF NOT EXISTS ledger_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    external_id TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN ('sale','payment','refund','fee','settlement','transfer','deposit')),
    occurred_on TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    method TEXT,
    note TEXT,
    sku_id TEXT,
    units INTEGER,
    unit_cost_paise INTEGER,
    source TEXT NOT NULL DEFAULT 'import',
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_merchant_date ON ledger_events (merchant_id, occurred_on, event_type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_fingerprint ON ledger_events (merchant_id, fingerprint)`,
  `CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    checksum TEXT NOT NULL,
    rows_total INTEGER NOT NULL,
    rows_imported INTEGER NOT NULL,
    rows_skipped INTEGER NOT NULL,
    rows_conflicting INTEGER NOT NULL,
    period_start TEXT,
    period_end TEXT,
    created_at TEXT NOT NULL,
    reversed_at TEXT
  )`,
  // Deposit requests ("collect a deposit for a phone order"): one collection
  // per order; replays of the same simulated success cannot double-collect.
  `CREATE TABLE IF NOT EXISTS deposit_requests (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    order_ref TEXT NOT NULL,
    description TEXT NOT NULL,
    order_paise INTEGER NOT NULL,
    deposit_paise INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','collected')),
    link_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    collected_at TEXT
  )`,
];

/** Run each static statement as a parameterless query - no dynamic SQL anywhere. */
async function runStatements(sql: SqliteDatabase, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

/**
 * A merchant row without any order rows is a husk - seedMerchant always fills
 * orders in the same transaction, so an empty one can only come from a broken
 * seed run. Dropping it lets the owning session reseed cleanly on its next
 * visit instead of serving empty screens labeled as seeded data.
 */
async function pruneChildlessMerchants(sql: SqliteDatabase): Promise<void> {
  await sql.unsafe(
    "DELETE FROM merchants WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.merchant_id = merchants.id)",
  );
}

/**
 * Validates a configured database connection string before it is used:
 * no control characters. (Kept from the SQLite era; the hosted data layer
 * uses DATABASE_URL, local tooling may still use a file path.)
 */
export function resolveDatabasePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Database path is empty.");
  const controlChars = new RegExp("[" + String.fromCharCode(0) + String.fromCharCode(13) + String.fromCharCode(10) + "]");
  if (controlChars.test(trimmed)) throw new Error("Database path contains control characters.");
  // Hosted-Postgres URLs (postgres://, libsql://) are legitimate here; any
  // other URL scheme (http://, file://, ...) is rejected - DATABASE_URL feeds
  // the postgres driver, which speaks only the database protocols above.
  const knownScheme = /^(postgres|postgresql|libsql):/i.test(trimmed);
  if (!knownScheme) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      throw new Error(`Database path must be a filesystem path or a postgres:// URL: ${trimmed}`);
    }
    // Filesystem path: must stay inside the project directory.
    const isWindowsAbsolute = /^[a-zA-Z]:[\/]/.test(trimmed);
    if (!isWindowsAbsolute && /(^|[\/])\.\.([\/]|$)/.test(trimmed)) {
      throw new Error(`Database path must stay inside the project directory (got ${trimmed}).`);
    }
  }
  return trimmed;
}

/** Translate SQLite-style `?` placeholders to Postgres `$n` positionals. */
function toPgPlaceholders(text: string): string {
  let index = 0;
  return text.replace(/\?/g, () => `$${++index}`);
}

function makePrepared(conn: SqliteDatabase, text: string): Prepared {
  const pgText = toPgPlaceholders(text);
  const logIfParamError = (args: unknown[]) => (e: any) => {
    if (e && (e.code === "42P18" || e.code === "42804")) {
      console.error("[db] parameter error:", e.code, "query:", pgText.replace(/\s+/g, " ").slice(0, 300));
      const shown = args.map((v) => (v === undefined ? "<<undefined>>" : v === null ? "<<null>>" : typeof v));
      console.error("[db] args:", JSON.stringify(shown).slice(0, 300));
    }
    throw e;
  };
  return {
    async get(...args: unknown[]): Promise<any> {
      const rows = await conn.unsafe(pgText, args).catch(logIfParamError(args));
      return rows[0];
    },
    async all(...args: unknown[]): Promise<any> {
      return await conn.unsafe(pgText, args).catch(logIfParamError(args));
    },
    async run(...args: unknown[]): Promise<RunResult> {
      const result = await conn.unsafe(pgText, args).catch(logIfParamError(args));
      return { changes: result.count ?? 0, lastInsertRowid: 0 };
    },
  };
}

/** Wrap a raw postgres.Sql (or a reserved connection) in the service-facing client. */
function wrapClient(raw: postgres.Sql): SqliteDatabase {
  const client: SqliteDatabase = {
    prepare: (text: string) => makePrepared(client, text),
    unsafe: (text: string, args?: unknown[]) =>
      raw.unsafe(toPgPlaceholders(text), (args ?? []) as postgres.ParameterOrJSON<never>[]) as Promise<
        Record<string, unknown>[] & { count?: number }
      >,
    reserve: async () => {
      const reserved = (await raw.reserve()) as unknown as postgres.Sql & { release: () => void };
      const reservedClient: SqliteDatabase = {
        prepare: (text: string) => makePrepared(reservedClient, text),
        unsafe: (text: string, args?: unknown[]) =>
          reserved.unsafe(toPgPlaceholders(text), (args ?? []) as postgres.ParameterOrJSON<never>[]) as Promise<
            Record<string, unknown>[] & { count?: number }
          >,
        // Reservations do not nest in this codebase; route to the same one.
        reserve: async () => ({ sql: reservedClient, release: reserved.release }),
      };
      return { sql: reservedClient, release: reserved.release };
    },
  };
  return client;
}

type GlobalWithDb = typeof globalThis & {
  __merchantSaathiSql?: SqliteDatabase;
  __merchantSaathiSqlInit?: Promise<void>;
};

/** Process-wide singleton used by route handlers, scripts and tests. */
export async function getDb(): Promise<SqliteDatabase> {
  const g = globalThis as GlobalWithDb;
  if (!g.__merchantSaathiSql) {
    let url = process.env.DATABASE_URL?.trim();
    if (!url) {
      // CLI scripts (tsx) do not auto-load .env.local - read just the
      // connection string from it. On Vercel this file does not exist and
      // the platform-injected DATABASE_URL is used instead.
      try {
        const envFile = fs.readFileSync(".env.local", "utf8");
        const match = envFile.match(/^DATABASE_URL=(.*)$/m);
        if (match) url = match[1].trim().replace(/^"/, "").replace(/"$/, "");
      } catch {
        // fall through to the clear error below
      }
    }
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set - the Postgres data layer needs a hosted Postgres connection string (see DEPLOY.md).",
      );
    }
    const sql = postgres(url, {
      // Hosted poolers (Neon's PgBouncer in transaction mode) do not support
      // named prepared statements - keep parsing on the client.
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => {},
    });
    const client = wrapClient(sql);
    await runStatements(client, SCHEMA_STATEMENTS);
    await pruneChildlessMerchants(client);
    g.__merchantSaathiSql = client;
    g.__merchantSaathiSqlInit = Promise.resolve();
  }
  await g.__merchantSaathiSqlInit;
  return g.__merchantSaathiSql;
}

/** Test helper: point the singleton at a specific database (isolated per suite). */
export async function openTestDatabase(url: string): Promise<SqliteDatabase> {
  const g = globalThis as GlobalWithDb;
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  const client = wrapClient(sql);
  await runStatements(client, SCHEMA_STATEMENTS);
  await pruneChildlessMerchants(client);
  g.__merchantSaathiSql = client;
  g.__merchantSaathiSqlInit = Promise.resolve();
  return client;
}

interface TxScope {
  conn: SqliteDatabase;
}

const txScope = new AsyncLocalStorage<TxScope>();

/** Standalone query builder outside the passed-around db handle. */
export function prepare(text: string): Prepared {
  return {
    async get(...args: unknown[]): Promise<any> {
      const conn = txScope.getStore()?.conn ?? (await getDb());
      return await makePrepared(conn, text).get(...args);
    },
    async all(...args: unknown[]): Promise<any> {
      const conn = txScope.getStore()?.conn ?? (await getDb());
      return await makePrepared(conn, text).all(...args);
    },
    async run(...args: unknown[]): Promise<RunResult> {
      const conn = txScope.getStore()?.conn ?? (await getDb());
      return await makePrepared(conn, text).run(...args);
    },
  };
}

/**
 * Run `fn` inside a transaction; rolls back on throw.
 *
 * The callback's `db.prepare()` calls run on the reserved connection through
 * the AsyncLocalStorage scope, so reads inside the transaction see its own
 * writes, and concurrent requests never interleave on the same connection.
 */
export async function withTransaction<T>(db: SqliteDatabase, fn: () => T | Promise<T>): Promise<T> {
  const base = txScope.getStore()?.conn ?? db;
  const reserved = await base.reserve();
  try {
    await reserved.sql.unsafe("BEGIN");
    try {
      const result = await txScope.run({ conn: reserved.sql }, () => fn());
      await reserved.sql.unsafe("COMMIT");
      return result;
    } catch (error) {
      await reserved.sql.unsafe("ROLLBACK");
      throw error;
    }
  } finally {
    reserved.release();
  }
}

/** Truncate every table (test isolation). CASCADE handles foreign keys. */
export async function truncateAll(db: SqliteDatabase): Promise<void> {
  await db.unsafe(`
    TRUNCATE TABLE audit_events, outbox, redemptions, approvals, campaigns,
      metric_snapshots, consents, order_items, orders, inventory, customers,
      ledger_events, import_batches, deposit_requests, idempotency_requests,
      merchants
    CASCADE
  `);
}
