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
Test Files  8 passed (8)
     Tests  88 passed (88)
```
Suites: `metrics.test.ts` (fixture totals, band filtering, clock edges), `offers.test.ts`
(margin floor, zero/negative price, missing cost = cannot-calculate, cap vs capacity,
DB-level non-negative stock), `approval.test.ts` (hash binding, unprofitable offers refused,
stale consent/inventory/version blocks, approval of queued or superseded versions refused,
execution after offer expiry refused, foreign campaign ids refused, cross-session draft
isolation, draft opportunity guard: made-up opportunity ids and thin-data drafting refused),
`idempotency.test.ts` (duplicate execute/redeem, key reuse conflicts, cap
enforcement, stock exhaustion, event amounts contradicting the approved offer, results of
unknown campaigns, tenant reset clears client idempotency keys, exact fixture results),
`ai.test.ts` (copy monetary guard, evidence allowlist, malformed live responses rejected),
`security-guards.test.ts` (database paths: project-relative only, no URL schemes, no
`..` escapes, no control characters; model endpoint: http(s) only, public hosts only,
IPv4/IPv6 loopback/private/link-local/reserved literals and localhost-style names refused,
IPv6 zone ids refused, numeric address encodings (decimal/octal/hex) refused, single-label
intranet names refused, IPv4 rules applied to IPv4-mapped addresses; the live fetch is
issued with redirect:"error" so a redirect cannot move the request onto an unvalidated host),
`merchants.test.ts` (multi-business sessions: adding capped at 6, ownership
guards that refuse foreign merchant ids without leaking them, variant reset in
place with identical regenerated numbers, removal isolation, insights whose
per-day 3-6 p.m. series sums exactly to the window totals, funnel stages null
until a campaign exists),
`assistant.test.ts` (chat intent routing; fact-book answers built from the seeded tenant's
computed numbers: decline 100 -> 70, margin 42.9% vs the 25% floor, the Rs 50 rejection,
the Rs 700/Rs 400/Rs 300 results story after the ten simulated events; rupee-token guard
for live model answers rejects invented amounts; assistant key settings: kept in server
memory, never returned unmasked, private/localhost endpoints and bad key shapes refused).

The suite is stable across repeated runs on a persistent `data/test.sqlite` (verified by
running `npm test` three times consecutively).

## 3. Lint / typecheck / build

```
> npm run lint        -> No ESLint warnings or errors
> npm run typecheck   -> (clean)
> npm run build       -> compiled successfully; 16 routes; first load JS ~104 kB
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

## 4b. Assistant smoke flow (same session)

```
POST /api/assistant/chat "Why are afternoon orders down?"
     200 mode=fixture intent=decline; answer carries 100 -> 70 (-30.0%),
     Rs 8,000 -> Rs 5,600, flat AOV Rs 80, no causal claim.
POST /api/assistant/chat "is the 70 offer safe?"
     200 mode=fixture intent=offer; margin 42.9%, floor 25%, exposure Rs 400,
     Rs 50 rejection mentioned.
POST /api/assistant/settings (valid key + model)   201 {configured: true, maskedKey: "....7890"}
POST /api/assistant/settings (localhost endpoint)  400 invalid_input (public http(s) hosts only)
DELETE /api/assistant/settings                     200 {configured: false}
```

The mascot UI (chat drawer, guided tour spotlight, unsafe-price reaction, sound
toggle) was additionally verified by clicking through the running production build
in a real browser: dashboard charts render, chat answers carry the fixture numbers,
the tour highlights each element, and the Rs 50 draft locks the approve button.

A full QA pass added the following observed results (production build, real browser):

- Assistant input validation: empty/1-char/501-char questions and malformed key,
  model and endpoint payloads all return 400 invalid_input with field errors.
- Chat: intent answers verified live for decline, offer, queue/consent and results
  (no campaign yet); mode badge, reasoning trace and follow-up chips render; the
  brain dialog refuses short keys and localhost endpoints with visible errors.
- Guided tour: opens from the chat header on every screen, all steps advance,
  finish closes cleanly.
- Offer flow: safe draft (margin meter "above floor", cap meter "feasible"),
  Rs 50 draft rejected with approve disabled, restore -> approve -> queue works;
  Hindi draft shows the review note.
- Campaign flow: 40 simulated recipients, apply all 10 events, waterfall
  Rs 700/−Rs 400/= Rs 300, cap meter 10/20, R-003 replay idempotent, event
  buttons check off.
- Thin-data demo: dashboard shows the honest 12 -> 8 windows and the opportunity
  page shows the insufficient-evidence alert; drafting via the API is refused
  (422 business_rule) - the offer workspace can no longer price an opportunity
  the evidence engine did not report.
- Mobile 360 px: dashboard and chat drawer verified.
- Sound toggle: mute/unmute persists per browser.
- docs/screenshots/ re-captured from the current build (mascot + charts now in
  every shot).

## 5. Browser E2E (Playwright, chromium)

```
> npx playwright test
ok 1 tests\e2e\merchant-flow.spec.ts (hero path)
  load data -> dashboard -30% -> draft -> unsafe price rejected (approve disabled)
  -> restore Rs 70 -> approve -> queue -> 40 simulated recipients
  -> apply all 10 events -> Rs 300 contribution -> duplicate replay changes nothing
1 passed
```

A second QA round added these observed results (production build):

- Multi-business: add/switch/remove verified in the browser; the second
  business shows different (still declining, still honest) numbers; ownership
  guard refuses foreign ids (404); cap enforced at 6.
- Mascot picker: all six characters render; choosing one switches the dock,
  chat header, tour and reactions; mood chips preview the animation + voice.
- Dashboard infographic: metric switcher (orders/sales/AOV) recomputes the
  story line; day-by-day bars match the KPI totals; funnel strip appears after
  queueing and fills to Rs 300.
- Resetting a business to a different fixture refreshes its generated name
  ("(thin-data demo)" does not survive a reset to standard data).

## Known limitations (honest list)

- Live AI path is implemented but **not smoke-tested with real credentials** in this run
  (no API key available). Fixture mode is the default and is visibly labeled. To verify live:
  set `AI_MODE=live` + `ZAI_API_KEY` + `ZAI_MODEL` in `.env.local` and restart. The same
  applies to the chat assistant's "live brain": the settings dialog, endpoint validation,
  fallback labeling and the rupee guard are tested, but an actual model round-trip needs
  a real key - until then the fact book answers everything.
- Sounds are synthesized in the browser (Web Audio); there are no audio assets to verify.
  The mute toggle persists per browser.
- Concurrency is guarded by `BEGIN IMMEDIATE` transactions; a multi-process load test was not run.
- Single-process prototype: SQLite requires a writable durable directory; no real auth
  (demo session cookie only), no rate limiting, no real messaging.
