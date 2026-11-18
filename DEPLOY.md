# Deploying Merchant Saathi

Read this before pointing any hosting service at the repo. The short version:
**the app now runs on Vercel's free tier with a hosted Postgres (Neon)** — the
data layer was ported from local SQLite to the `postgres` driver (same SQL
surface, same schema, same invariants). It also still runs as-is on any host
that provides a durable local disk and a long-running Node process (the
original Option A below).

## What is live right now (executed 2026-11-17)

- **Live URL:** https://merchant-saathi.vercel.app/merchant
- **Stack:** Next.js 14 on Vercel (free tier) + Neon Postgres via the Vercel
  marketplace integration (free tier, pooled connection string).
- **Verified on the production URL:** session-scoped seed, offer draft ->
  hash-bound approval -> queue -> 40-recipient outbox -> simulated
  redemptions -> Rs 700 - Rs 400 = Rs 300 results, with state persisting
  across independent requests and reloads.
- **Env vars on Vercel** (never commit): DATABASE_URL (Neon integration) and
  DEMO_MODE=true. There is deliberately no env-based model path: live model
  credentials are entered per session in the chat's key dialog (server memory,
  public-host validated), so no environment value ever flows into a fetch.
- The 117-test suite and the fixtures gate (`npm run fixtures:verify`) run
  against the same hosted Postgres via DATABASE_URL.

## Data-layer port notes (Option B, executed)

- `src/lib/db.ts` keeps the historical call shape — `db.prepare(sql).get/all/run(...)`
  with `await` added — so the 40+ call sites changed minimally.
- SQLite `?` placeholders are translated to Postgres `$n` positionals in the
  facade; `AUTOINCREMENT` became `GENERATED ALWAYS AS IDENTITY`; the IST
  bucketing uses `(occurred_on::timestamp + interval '5 hours 30 minutes')`.
- `withTransaction` reserves a dedicated connection (postgres.js `reserve()`)
  and scopes it through AsyncLocalStorage, so transaction bodies are unchanged
  and reads inside a transaction see its own writes.
- Tests run sequentially (fileParallelism: false) against the same hosted
  database; tenants are session-scoped so suites do not interfere.
- Aggregates that tests assert on are cast `::int` in SQL — Postgres returns
  bigint as strings and the suites compare exact numbers.

## Why local SQLite could not go to Vercel (historical context)

The pre-port app kept state in **better-sqlite3** — a synchronous, local file
(`data/merchant-saathi.sqlite`) with `BEGIN IMMEDIATE` transactions, idempotent
receipts, and startup seeding. Vercel Functions have no shared durable disk:
each instance gets its own ephemeral `/tmp`, so two requests can land on two
different databases and everything written is lost on recycle. This is a
documented Vercel limitation (https://vercel.com/kb/guide/is-sqlite-supported-in-vercel),
not a bug we can config away.

The campaign/reward logic depends on durability (approval hash binding,
idempotent receipts, cap enforcement inside one transaction). Shipping that
build to Vercel would have produced a demo that silently loses state —
which is why the data layer was ported to Postgres instead.

## Hosting options

**Deployed - Vercel + Neon Postgres (current)**

1. `vercel link --project merchant-saathi` and install the Neon marketplace
   integration (`vercel integration add neon`) — it provisions DATABASE_URL.
2. Set AI_MODE / DEMO_MODE / LLM_* via `vercel env add`.
3. `npx vercel --prod` (or connect the GitHub repo for push deploys).
4. Verify: `/api/demo/state` from a fresh session, register a business, queue a
   campaign, refresh — the state survives.

**Option A - persistent-disk host (runs a SQLite build unchanged)**

1. Push the repo (it is on GitHub).
2. Create a Web Service on Render/Railway/Fly (or a small VM): Node 20+,
   `npm ci && npm run build && npm start`, attach a persistent disk mounted at
   the project root (or set `DATABASE_PATH` to a durable path).
3. Set env vars from `.env.example` (`AI_MODE=fixture` by default; `DEMO_MODE=true`
   pins the demo clock for judging).
4. Verify: `/api/demo/state` from a fresh session, register a business, queue a
   campaign, refresh — the state survives.

**Option B - Vercel (needs a one-time data-layer port)**

1. Port the repository pattern from better-sqlite3 to a hosted transactional
   Postgres (Neon/Supabase) — the SQL is already parameterized and centralized
   in `src/lib/db.ts` + `src/services/*`, but the synchronous API becomes async,
   which touches every call site. Add versioned migrations for the schema in
   `src/lib/db.ts`.
2. Keep local dev on SQLite or switch to dockerized Postgres; keep the seeder
   out of production startup (demo seeding becomes an explicit, labeled action).
3. Move the chat-brain key store (`src/lib/assistant-settings.ts`) from process
   memory to the database, scoped per owner, or disable the key-setting endpoint
   in production and use server-managed model configuration.
4. Configure secrets in the Vercel dashboard (never in source):
   `DATABASE_URL`, `AI_MODE`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`.
5. Deploy a preview first, verify persistence across requests and user
   isolation, then promote to production.

## Commands we ran to verify the release build

```bash
npm ci
npm run db:seed && npm run fixtures:verify   # every domain fixture reconciled
npm test                                      # unit suites
npm run lint && npm run typecheck && npm run build
npm run test:e2e                              # hero path in a real browser
```

## What is intentionally NOT deployed

- **Receipt OCR, device-sync QR, Paytm payment QR, referrals and cashback** are
  designed in the upgrade plan but not implemented; they need external provider
  credentials (an image-capable model, a Paytm merchant account, a funded reward
  inventory) and durable platform accounts. Nothing in the current build calls
  those providers, so there are no half-wired stubs to deploy.
- The AI ships in **fixture mode** by default (labeled on every screen). Live
  mode needs `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` — any OpenAI-compatible
  endpoint; the endpoint host is validated server-side before any request.

## Rollback

The app is a single Node process with one SQLite file. Rollback = redeploy the
previous commit (the repo builds identically from any commit) and keep the data
file — the schema is created idempotently, and the legacy-DB migration is a
one-way, guarded rebuild that has been tested against pre-migration databases.
