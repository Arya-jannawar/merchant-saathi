# Deploying Merchant Saathi

Read this before pointing any hosting service at the repo. The short version:
**the app is deployable as-is on any host that provides a durable local disk and a
long-running Node process (a small VM, Render/Railway/Fly with a persistent
volume, or your own box). It is NOT yet deployable as-is on Vercel**, because
the data layer is SQLite.

## Why not Vercel today

The inspected app keeps state in **better-sqlite3** — a synchronous, local file
(`data/merchant-saathi.sqlite`) with `BEGIN IMMEDIATE` transactions, idempotent
receipts, and startup seeding. Vercel Functions have no shared durable disk:
each instance gets its own ephemeral `/tmp`, so two requests can land on two
different databases and everything written is lost on recycle. This is a
documented Vercel limitation (https://vercel.com/kb/guide/is-sqlite-supported-in-vercel),
not a bug we can config away.

The campaign/reward logic depends on that durability (approval hash binding,
idempotent receipts, cap enforcement inside one transaction). Shipping the
current build to Vercel would produce a demo that silently loses state —
we refuse to present that as a deployment.

## The honest path to a live link

**Option A - persistent-disk host (fastest, runs today's code unchanged)**

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
