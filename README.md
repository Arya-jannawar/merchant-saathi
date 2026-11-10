# Merchant Saathi

**An AI business partner for a bakery's quiet afternoons.**
Paytm AI Hackathon Pune - Track 1: Merchant Growth AI. Team FinovateX (Arya Jannawar, Avani Jannawar, Siddhant Pardeshi).

A dashboard alone tells a small merchant that orders are down. It does not tell them **what to do about it**, whether the fix is **affordable**, what to **say to customers**, or whether it **worked**. Merchant Saathi closes that loop: it shows one evidence-backed opportunity, proves every number behind it, refuses offers that would lose money, and turns the owner's approval into a trackable, **simulated** campaign.

**The USP: proof, not a black box.** Every number on screen links to its metric definition, window and source. The AI drafts explanations and customer copy but can never set prices, caps, dates or eligibility. Unprofitable offers are visibly rejected before anything can be queued.

> All data, people, and customers in this demo are synthetic. Campaigns are simulated. No real messages are ever sent.
> This is not an official Paytm product and claims no endorsement.

## Watch the walkthrough (8 minutes, narrated)

A complete narrated product tour lives in
[`docs/media/merchant-saathi-walkthrough.mp4`](docs/media/merchant-saathi-walkthrough.mp4):
the problem and the evidence receipts, the offer math, the Rs 50 guardrail rejection, the bounded
AI draft (English and Hindi), hash-bound approval, the simulated outbox, idempotent redemptions and
cap enforcement, the audit trail, the architecture, and the honest labels - ending with the credits.

---

## At a glance

![Merchant Saathi dashboard](docs/screenshots/01-dashboard.png)

**The one-minute version of the build:**

1. A synthetic Pune bakery (`bakery-v1`) seeds 616 orders, a 50-customer demo CRM and a consent register. A demo clock is pinned to Fri 6 Nov 2026, 7:00 p.m. IST so the two compared windows are always complete.
2. The dashboard surfaces one opportunity: completed 3-6 p.m. orders fell **100 → 70 (-30%)**, net sales **₹8,000 → ₹5,600**, AOV flat at **₹80** - so the problem is order count, not basket size.
3. The owner builds a bundle offer (two samosas + one tea at ₹70). Server code computes margin, stock capacity and discount exposure in integer paise. A ₹50 price fails the 25% margin floor and **cannot be approved**.
4. The AI (fixture mode by default, live Z.ai optional) drafts the explanation and customer message **from the verified numbers only** - English or Hindi.
5. The owner approves the exact version (bound by a payload hash). 40 consented customers enter a **simulated** outbox inside one transaction. Ten fixture redemption events apply idempotently: **₹700 − ₹400 = ₹300 contribution**, every screen labeled *Simulated campaign outcomes*.

---

## Mithu, the guide (mascot + chat)

A cupcake named **Mithu** floats on every screen and runs the tour for you:

- **Guided tour** - "Show me around" in the chat walks through each screen with a spotlight on the exact element (per-route steps, skip/next, progress dots, honors reduced-motion).
- **Chat that only knows real numbers** - ask *why orders fell*, *is ₹70 safe*, *what approving does*, or *what the campaign earned*. Without any key, a deterministic "fact book" answers from the session's computed facts (same domain functions as the screens). Each answer shows a *How I reasoned* trace.
- **Optional live brain** - paste a provider API key + model id in the brain (🧠) dialog and answers become generative with deeper reasoning. A rupee guard re-checks every amount in the model's reply against the computed facts; any invented number, malformed reply or endpoint failure falls back to the labeled fact book instead.
- **The key stays server-side** - process memory only, never on disk, never sent back to the browser (masked status only), validated against the same public-host rules as the live draft adapter. A server restart clears it.
- **Reactions** - Mithu celebrates approvals, panics at unsafe prices, and explains refusals; pages trigger her through a tiny `useSaathi()` API.

## Charts & sound (zero new dependencies)

- Every screen shows the numbers as pictures: window-comparison bars and a flat-AOV line on the dashboard, a consent donut, live **margin-vs-floor and cap-vs-capacity meters** in the offer workspace, cap utilization and a **money waterfall (₹700 − ₹400 = ₹300)** on the campaign page. Hand-rolled SVG/CSS in `src/components/charts.tsx`; values come straight from the same computed DTOs as the text - no hand-drawn chart data.
- UI and mascot sounds are synthesized at runtime with the Web Audio API (`src/lib/sound.ts`) - no audio assets in the repo; the 🔊 toggle sits bottom-left and the preference is remembered per browser.

---

## The workflow, screen by screen

### 1. Evidence, not vibes - the opportunity page

The dashboard shows the KPI deltas; the opportunity page explains the decline in plain language and opens the **evidence drawer**: six numbered checks, each with its metric id (`afternoon-order-delta-v1`, `bundle-margin-v1`, ...), the exact value, its definition, the window it covers and the source table it came from. Under it, an explicit *"What this evidence does NOT say"* panel states that two five-day windows support a testable suggestion but do not prove cause, and that variable costs cover ingredients and packaging only.

![Opportunity page with evidence drawer](docs/screenshots/02-opportunity-evidence.png)

Why this matters: the app would rather say "we don't know why" than invent a reason. The AI's system prompt carries the same rule - it may not invent causes, lift, or a Paytm endorsement.

### 2. Design the offer with live math

The offer workspace recomputes on every change, **in server code, before anything is queued**:

| Term | Value | How it is derived |
| --- | --- | --- |
| Bundle | 2 samosas + 1 tea | Fixed in the fixture; stock and costs read live from the inventory table |
| Usual combined price | ₹90 | 2 × ₹35 + ₹20 |
| Variable cost / bundle | ₹40 | 2 × ₹15 + ₹10 (from inventory; `NULL` cost = "cannot calculate", never zero) |
| Contribution / margin | ₹30 / 42.9% | price − cost, then ÷ price; compared against the 25% policy floor |
| Stock capacity | 25 bundles | min over components of floor(stock ÷ quantity per bundle) |
| Max discount exposure | ₹400 | (₹90 − ₹70) × cap 20 |

![Offer workspace with draft, live check and approval preview](docs/screenshots/04-offer-draft-approved-math.png)

### 3. Unprofitable offers are refused, visibly

Set the price to ₹50 and the margin drops to 20.0% - below the 25% floor. The check turns red, **Approve is disabled**, and the refusal message explains the arithmetic ("₹10 left after ₹40 variable cost"). Nothing downstream (approval, queue, redemption) can accept this offer, because the same `computeOffer()` runs again server-side at approval time.

![Unsafe price rejected](docs/screenshots/05-unsafe-price-rejected.png)

### 4. AI drafts the words, never the numbers

The AI adapter drafts the headline, explanation and customer message from the verified metrics and offer math. It is **bounded on five levels**:

- **Schema**: the live response must parse into a Zod-validated shape (headline/explanation/assumptions/copy).
- **Evidence allowlist**: every evidence id it cites must exist in the computed set - invented ids are rejected.
- **Monetary guard**: generated copy may only contain the computed price token and must mention the cap; any other money figure falls back to a template.
- **No write access**: the adapter returns prose only. It cannot touch the database, prices, caps, dates or consent.
- **Endpoint guard**: before any live request, the configured base URL is validated - http(s) only, and loopback/private/link-local/reserved hosts are refused (including numeric encodings like `2130706433` or `0177.0.0.1` and IPv6 zone ids), so a misconfigured `ZAI_BASE_URL` cannot make the server call into the local network. The request itself refuses redirects, so a redirect can never move the call onto an unvalidated host. The database path gets the same treatment: project-relative paths only, no `..` escapes, no URL schemes.

`AI_MODE=fixture` (default) produces the same deterministic draft with no credentials and a visible *Honest fallback - no model call was made* note. `AI_MODE=live` calls the Z.ai chat-completions endpoint with a 15 s timeout and one bounded retry; any failure falls back to the labeled fixture draft with the reason shown.

Customer copy can be generated in English or Hindi. The Hindi version ships with an honest warning: *draft translation - have a Hindi speaker review the financial wording before any real use*.

![Hindi customer copy toggle](docs/screenshots/03-offer-hindi-copy.png)

### 5. Approve the exact version (hash-bound)

**Approve** binds a SHA-256 preview hash of (id, version, price, cap, audience hash, inventory version, expiry). Any change to any of those facts afterwards invalidates the approval - approve returns `409 stale_preview`. Execution rechecks everything again server-side: latest version only, hash matches, not expired, inventory version unchanged, audience consent hash unchanged. This is the control loop that makes "the AI suggested it" never mean "the AI did it".

### 6. Queue a simulated campaign (transactional, idempotent)

The button says **Queue simulated campaign** - never "send". 40 consented customers (revoked/missing consents excluded automatically) enter a simulated outbox inside a `BEGIN IMMEDIATE` transaction, one row per recipient with a per-recipient idempotency key. A repeated execute returns the original receipt (`duplicate: true`) instead of double-queuing; a reused client key with different input gets `409`.

![Campaign activity - approved terms and simulated outbox](docs/screenshots/06-campaign-activity.png)

### 7. Simulated redemptions with atomic cap enforcement

Ten fixture events (R-001…R-010) can be applied one by one or all at once. Replaying an event changes nothing (the UI even offers a **Re-apply R-003** button to demo this live), the 20/day cap is enforced by a count inside the transaction, amounts must equal approved price × quantity, and component stock is re-checked cumulatively. Results: **₹700 sales − ₹400 variable cost = ₹300 contribution**, labeled *Simulated campaign outcomes*, with a full audit trail underneath.

![Simulated results with idempotent replay](docs/screenshots/07-simulated-results.png)

### 8. Saying "insufficient evidence" is a feature

The **Thin-data demo** loads a second fixture (`bakery-thin-v1`: 12 vs 8 afternoon orders). Eligibility requires both windows complete with ≥ 20 completed afternoon orders and ≥ 10% decline, so the app refuses to recommend and explains exactly why - the honest behaviour a real product needs when a merchant's history is thin.

![Thin-data: insufficient evidence](docs/screenshots/08-thin-data-insufficient-evidence.png)

---

## What is real vs simulated

| | Computed in code (real logic) | Labeled as simulated |
| --- | --- | --- |
| **Real** | sales metrics, offer economics, capacity, consent filtering, approval binding, idempotency, cap enforcement, results arithmetic | |
| **Simulated** | | bakery dataset (`bakery-v1`), customer list + consents, message delivery (outbox, never sends), redemptions (10 fixture events), the demo clock (pinned Fri 6 Nov 2026 7:00 p.m. IST) |
| **AI** | drafts explanation + copy only, from verified facts | fixture (default) or live Z.ai; failures fall back visibly |

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript strict + Tailwind CSS           |
| Data       | SQLite via better-sqlite3 (Node server runtime only)          |
| Validation | Zod (all API payloads + AI responses)                         |
| AI         | Z.ai chat-completions adapter (`AI_MODE=live`) + labeled fixture fallback |
| Tests      | Vitest (55 unit tests) + Playwright (hero path e2e) + fixture reconciliation gate |

### Architecture in one picture

```
Browser (client components, fetch)
   |
   v
API route handlers (src/app/api/**)   <-- thin: session + Zod parse + service call
   |
   v
Services (src/services/)              <-- transactional campaign lifecycle
   |         |
   |         +--> Domain (src/domain/)  <-- pure logic: metrics, offers, consent
   |
   +--> Adapters (src/adapters/ai.ts)   <-- bounded: fixture | live Z.ai | labeled fallback
   |
   v
SQLite (src/lib/db.ts, schema auto-created)
```

Layer rules that keep the guarantees intact:

- Route handlers stay thin - no business decisions in routes.
- Domain functions are pure-ish (they take the db handle; no React, no HTTP).
- The AI adapter can never write to the database; it returns prose, validated and allowlisted.
- Money is **integer paise everywhere** (₹70 = 7000); formatting happens only at the UI edge (`src/lib/money.ts`).
- Afternoon windows are the **union of five daily 15:00-18:00 IST bands**, not a continuous Mon-Fri range - a continuous range would wrongly count morning orders. Timezone math is a fixed UTC+5:30 offset (no DST, no external tz library), in `src/lib/clock.ts`.

### Sessions and tenants

Each browser gets an httpOnly `ms_demo_sid` cookie mapped to one synthetic tenant row. Every business row carries `merchant_id` and every query filters by it; tenant identity never comes from a request body. "Load sample data" / "Reset demo" deletes and reseeds only that session's tenant, so multiple judges can demo simultaneously without resetting each other. A client-supplied campaign id that belongs to another tenant returns a clean `404`.

## Quick start

```bash
npm install
npm run db:seed          # create + seed ./data/merchant-saathi.sqlite
npm run fixtures:verify  # reconcile every fixture number (must be all PASS)
npm run dev              # http://localhost:3000/merchant
```

Open **http://localhost:3000/merchant** and click **Load sample data**.

### Environment

Copy `.env.example` to `.env.local`. Defaults are safe: `AI_MODE=fixture` (no credentials needed, visibly labeled), `DEMO_MODE=true` (clock pinned to Fri 6 Nov 2026, 7:00 p.m. IST so the demo windows stay complete).

For live AI: set `AI_MODE=live`, `ZAI_API_KEY`, `ZAI_MODEL` (standard Z.ai application API key; endpoint `https://api.z.ai/api/paas/v4/chat/completions`). Live failures fall back to the labeled fixture draft with the reason shown.

## Scripts

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Dev server at :3000                                        |
| `npm run build`        | Production build                                           |
| `npm start`            | Production server                                          |
| `npm run lint`         | ESLint (next/core-web-vitals)                              |
| `npm run typecheck`    | `tsc --noEmit`                                             |
| `npm test`             | Vitest unit tests (money, approval, consent, idempotency)  |
| `npm run test:e2e`     | Playwright hero-path flow (build first; runs its own server on :3100) |
| `npm run db:seed`      | Seed the default database                                  |
| `npm run fixtures:verify` | Verify all fixture invariants; non-zero exit on mismatch |

Full check before any demo or PR:

```bash
npm run fixtures:verify && npm test && npm run lint && npm run typecheck && npm run build
```

## API contract (all session-scoped)

| Route                              | Method | Notes                                                                 |
| ---------------------------------- | ------ | --------------------------------------------------------------------- |
| `/api/demo/state`                  | GET    | Seeded/unseeded + KPIs + AI mode                                       |
| `/api/demo/reset`                  | POST   | Resets **this browser session's** tenant and reseeds                   |
| `/api/opportunities`               | GET    | Evidence-backed opportunities (or a low-data reason)                   |
| `/api/campaigns/draft`             | POST   | Creates a draft version; returns computed terms + AI copy + previewHash |
| `/api/campaigns/{id}/approve`      | POST   | Binds the exact preview hash; stale previews get 409                   |
| `/api/campaigns/{id}/execute`      | POST   | Transactional simulated queue; idempotent; rechecks stock/consent/expiry |
| `/api/demo/campaigns/{id}/redeem`  | POST   | Fixed fixture event ids only; replays idempotent; cap enforced         |
| `/api/campaigns/{id}/results`      | GET    | Activity + simulated outcomes + audit trail                            |
| `/api/assistant/chat`              | POST   | Mithu's answers: fact book (default) or rupee-checked live model reply |
| `/api/assistant/settings`          | GET/POST/DELETE | Chat brain key: stored in server memory, masked status, public-host validation |

Errors: `{ "error": { "code", "message", "fieldErrors?", "retryable?" } }` with meaningful status codes (400/401/403/404/409/422/429/503). Tenant identity comes from the server session cookie - never from a caller-supplied merchant ID.

## Money & lifecycle invariants (tested)

- All money is **integer paise**. No floats touch stored amounts.
- Contribution = price − variable cost; margin = contribution / price; floor 25%.
- Missing SKU cost => "cannot calculate", never zero-cost.
- Capacity = min(floor(stock / per-bundle quantity)); a cap above capacity is refused, not silently lowered.
- Line items sum exactly to order totals (verified by `fixtures:verify` and tests).
- Approval binds a hash of price+cap+audience+inventory version+expiry; execution rechecks all of them.
- Duplicate execute / duplicate redemption events have no double effect; cap 20 enforced atomically.
- Executing after the offer's validity window passes is refused (`expired`); redemptions stop when component stock runs out; events whose amount contradicts the approved price are rejected.
- A client-supplied campaign id must already belong to the session's tenant - foreign or unknown ids get a clean 404, never an internal error.
- Resetting a session clears its stored idempotency receipts, so client keys cannot replay or conflict after a reset.

## Honest labels

- Fixture data is labeled **Synthetic demo data (bakery-v1)**; the demo clock is labeled **injected**.
- AI mode shows **fixture**, **live**, or **fallback (labeled)** with the failure reason.
- Results are labeled **Simulated campaign outcomes**; contribution is not claimed as proven incremental profit.
- Variable costs cover ingredients and packaging only - not rent, labour, tax or spoilage.

## Project layout

```
src/
  app/                     # pages + API route handlers (thin)
    api/...                # demo/state, demo/reset, opportunities, campaigns/draft|approve|execute|results, demo redeem, assistant/chat, assistant/settings
    merchant/              # dashboard, opportunity, offer workspace
    campaigns/[id]/        # activity, simulated outbox, redemptions, results
  components/              # opportunity-card, evidence-drawer, ui primitives,
                           # mascot + saathi provider/chat/tour/brain-modal, charts
  domain/                  # metrics, offers, consent (pure business logic)
  services/                # campaigns lifecycle, demo state (transactional core)
  adapters/ai.ts           # bounded AI adapter: fixture | live Z.ai | fallback
  lib/                     # db, clock (IST windows), money (paise), session, validation, errors, http,
                           # saathi-brain (fact book + live prompts + rupee guard), assistant-settings, sound
  fixtures/bakery-v1.json  # single source of truth for every demo number
scripts/                   # seed CLI + fixture verifier
tests/                     # vitest suites (incl. assistant.test.ts) + playwright e2e
docs/screenshots/          # UI captures used in this README
```

## Verified locally

Recorded from an actual run on this machine (Windows 11, Node 24, npm 11):

- `npm run fixtures:verify` - all checks PASS
- `npm test` - 78 unit tests passing (including the config-guard suites for database paths and the model endpoint, and the assistant suites for the fact book, the rupee guard and the key settings)
- `npm run lint` / `npm run typecheck` - clean
- `npm run build` - production build succeeds
- `npm run test:e2e` - hero path passes (requires build first; first run downloads Chromium)

See `docs/VERIFICATION.md` for the exact observed output.

## Deployment notes (prototype scope)

This is a **single-process prototype**: SQLite needs a writable durable directory (a small VM or local machine; not
ephemeral serverless storage). For multi-instance production you would move the repository adapter to managed
PostgreSQL, add durable jobs, real authentication and rate limits, and per-tenant fixture isolation. That design is
future work, not something this build claims.

## Demo script (3 minutes)

1. 0:00-0:25 - the bakery's quiet afternoons; synthetic data label.
2. 0:25-0:55 - reveal the 30% decline; click evidence; matching windows and counts.
3. 0:55-1:25 - build the offer; inspect AI explanation and fixed offer math.
4. 1:25-1:55 - try Rs 50 -> rejection; restore Rs 70 -> approve the exact preview.
5. 1:55-2:20 - queue the simulated campaign; excluded contacts; activity trail.
6. 2:20-2:40 - apply redemptions; Rs 300 contribution; no causal-lift claim.
7. 2:40-3:00 - real integration path and next pilot (3-5 Pune bakery owners).

## Troubleshooting: "Cannot find module './NNN.js'" (dev server)

If the dev server shows `Server Error: Cannot find module './276.js'` (or a similar chunk number) after you ran
`npm run build`, the production build clobbered the dev server's `.next` cache — both share that folder and cannot run
at the same time. Fix: stop the dev server (`Ctrl+C`), delete `.next`, and start `npm run dev` again. Rule of thumb:
**never run `npm run build` while `npm run dev` is running** (use `npm run fixtures:verify` + `npm test` for quick
checks instead — they do not touch `.next`).
