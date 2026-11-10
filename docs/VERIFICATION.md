# Verification record

Environment: Windows 11, Node v24.15.0, npm 11.12.1, better-sqlite3 12.x (prebuilt), Next.js 14.2.x.
All commands run from the project root. Observed output summarized below (from the actual delivery run).

## 1. Fixture reconciliation

```
> npm run db:seed
[seed] tenant mrc_localdevsession seeded: { merchants: 1, orders: 616, order_items: 945,
        customers: 50, consents: 50, snapshots: 6 }

> npm run fixtures:verify
PASS  current window label (2-6 Nov 2026)
PASS  previous window label (26-30 Oct 2026)
PASS  previous completed afternoon orders 100
PASS  previous net sales (paise) 800000
PASS  current completed afternoon orders 70
PASS  current net sales (paise) 560000
PASS  orders delta % -30
PASS  net sales delta % -30
PASS  previous AOV (paise) 8000
PASS  current AOV (paise) 8000
PASS  pending/canceled excluded ... (1 each, present but excluded)
PASS  all orders reconcile with line items
PASS  inventory quantities + unit costs (5 SKUs)
PASS  bundle physical capacity 25
PASS  bundle normal price 9000 / proposed 7000 / variable cost 4000
PASS  bundle contribution 3000 / margin 42.857%
PASS  max discount exposure 40000
PASS  eligible customers 40 / excluded 10 / total 50
PASS  R-001..R-010 amounts and consented customers
PASS  simulated result: revenue 70000 = 10 x 7000; cost 40000; contribution 30000; discount 20000
PASS  IST conversions (Mon 2 Nov 15:00 IST = 2026-11-02T09:30:00Z; Fri 6 Nov 18:00 IST = 2026-11-06T12:30:00Z)

All fixture checks passed.
```

## 2. Unit tests (Vitest)

```
> npm test
Test Files  6 passed (6)
     Tests  68 passed (68)
```
Suites: `metrics.test.ts` (fixture totals, band filtering, clock edges), `offers.test.ts`
(margin floor, zero/negative price, missing cost = cannot-calculate, cap vs capacity,
DB-level non-negative stock), `approval.test.ts` (hash binding, unprofitable offers refused,
stale consent/inventory/version blocks, approval of queued or superseded versions refused,
execution after offer expiry refused, foreign campaign ids refused, cross-session draft
isolation), `idempotency.test.ts` (duplicate execute/redeem, key reuse conflicts, cap
enforcement, stock exhaustion, event amounts contradicting the approved offer, results of
unknown campaigns, tenant reset clears client idempotency keys, exact fixture results),
`ai.test.ts` (copy monetary guard, evidence allowlist, malformed live responses rejected),
`security-guards.test.ts` (database paths: project-relative only, no URL schemes, no
`..` escapes, no control characters; model endpoint: http(s) only, public hosts only,
IPv4/IPv6 loopback/private/link-local/reserved literals and localhost-style names refused,
IPv6 zone ids refused, numeric address encodings (decimal/octal/hex) refused, single-label
intranet names refused, IPv4 rules applied to IPv4-mapped addresses; the live fetch is
issued with redirect:"error" so a redirect cannot move the request onto an unvalidated host).

The suite is stable across repeated runs on a persistent `data/test.sqlite` (verified by
running `npm test` three times consecutively).

## 3. Lint / typecheck / build

```
> npm run lint        -> No ESLint warnings or errors
> npm run typecheck   -> (clean)
> npm run build       -> compiled successfully; 14 routes; first load JS ~92 kB
```

## 4. API smoke flow (production server, fixture AI mode)

```
POST /api/demo/reset          200 {fixtureVersion: bakery-v1}
GET  /api/demo/state          200 prev 100/800000  curr 70/560000  delta -30  audience 40/10
POST /api/campaigns/draft     201 margin 42.857% passes=true  aiMode=fixture
POST /api/campaigns/draft     201 price 5000 -> passes=false "Margin 20.0% is below the 25% floor"
POST .../approve (unsafe)     422 business_rule
POST .../approve (safe)       201 {approvalId, approvedVersion: 1}
POST .../execute              201 {status:"simulated_queued", count: 40}
POST .../execute (repeat)     201 duplicate=true (same receipt, no double queue)
POST /redeem R-001..R-010     201 (10 unique)
POST /redeem R-003 (repeat)   201 redemption.duplicate=true (no double count)
GET  /api/campaigns/{id}/results  200 redemptions 10, revenue 70000, cost 40000,
                                  contribution 30000, discount 20000, outbox 40
POST /api/campaigns/draft with another session's campaign id   404 not_found
POST /api/campaigns/draft with a malformed campaign id          400 invalid_input
```

## 5. Browser E2E (Playwright, chromium)

```
> npx playwright test
ok 1 tests\e2e\merchant-flow.spec.ts (hero path)
  load data -> dashboard -30% -> draft -> unsafe price rejected (approve disabled)
  -> restore Rs 70 -> approve -> queue -> 40 simulated recipients
  -> apply all 10 events -> Rs 300 contribution -> duplicate replay changes nothing
1 passed
```

## Known limitations (honest list)

- Live AI path is implemented but **not smoke-tested with real credentials** in this run
  (no API key available). Fixture mode is the default and is visibly labeled. To verify live:
  set `AI_MODE=live` + `ZAI_API_KEY` + `ZAI_MODEL` in `.env.local` and restart.
- Concurrency is guarded by `BEGIN IMMEDIATE` transactions; a multi-process load test was not run.
- Single-process prototype: SQLite requires a writable durable directory; no real auth
  (demo session cookie only), no rate limiting, no real messaging.
