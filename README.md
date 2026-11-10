# Merchant Saathi

**An AI business partner for a bakery's quiet afternoons.**
Paytm AI Hackathon Pune - Track 1: Merchant Growth AI. Team FinovateX (Arya Jannawar, Avani Jannawar, Siddhant Pardeshi).

Merchant Saathi shows a small merchant one evidence-backed opportunity, proves the numbers behind it, and turns the
owner's decision into a trackable, **simulated** campaign - inspect, edit terms, approve. Proof, not a black box.

> All data, people, and customers in this demo are synthetic. Campaigns are simulated. No real messages are ever sent.
> This is not an official Paytm product and claims no endorsement.

---

## What it does (the hero workflow)

1. **Load sample data** - one transparent synthetic bakery dataset (`bakery-v1`) with an injected demo clock.
2. **See the opportunity** - completed 3-6 p.m. orders fell 100 -> 70 (-30%) between 26-30 Oct and 2-6 Nov 2026; AOV flat at Rs 80. Every number links to a metric definition, window, and source (the "evidence receipt"). Load the **Thin-data demo** (12 vs 8 orders) to watch the app refuse to recommend and say "insufficient evidence" instead.
3. **Build an offer** - two samosas + one tea at Rs 70 (usual Rs 90). Server code computes contribution (Rs 30), margin (42.9% vs a 25% floor), stock capacity (25 bundles), cap (20/day) and max discount exposure (Rs 400). Try Rs 50: the check fails at 20% margin and the offer cannot be approved. Customer copy can be toggled to Hindi (draft translation - review before real use).
4. **AI draft, bounded** - the model (fixture or live Z.ai) drafts the explanation and customer copy from verified facts only. It cannot change prices, caps, dates, or eligibility; generated copy is validated against computed terms.
5. **Approve the exact version** - the approval binds a payload hash. Any change to price, stock, consent or terms invalidates it (409).
6. **Queue the simulated campaign** - 40 consented demo customers enter a simulated outbox (idempotent, transactional). The button never says "send".
7. **Apply simulated redemptions** - 10 fixture events; replays are idempotent; the cap is enforced atomically. Results: Rs 700 - Rs 400 = **Rs 300 contribution** toward fixed costs, labeled *Simulated campaign outcomes*.

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript + Tailwind CSS           |
| Data       | SQLite via better-sqlite3 (Node server runtime only)          |
| Validation | Zod (all API payloads + AI responses)                         |
| AI         | Z.ai chat-completions adapter (`AI_MODE=live`) + labeled fixture fallback |
| Tests      | Vitest (money/approval/idempotency invariants) + Playwright (hero path) |

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

## Project layout

```
src/
  app/                     # pages + API route handlers (thin)
    api/...                # demo/state, demo/reset, opportunities, campaigns/draft|approve|execute|results, demo redeem
    merchant/              # dashboard, opportunity, offer workspace
    campaigns/[id]/        # activity, simulated outbox, redemptions, results
  components/              # opportunity-card, evidence-drawer, ui primitives
  domain/                  # metrics, offers, consent (pure business logic)
  services/                # campaigns lifecycle, demo state (transactional core)
  adapters/ai.ts           # bounded AI adapter: fixture | live Z.ai | fallback
  lib/                     # db, clock (IST windows), money (paise), session, validation, errors, http
  fixtures/bakery-v1.json  # single source of truth for every demo number
scripts/                   # seed CLI + fixture verifier
tests/                     # vitest suites + playwright e2e
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

Errors: `{ "error": { "code", "message", "fieldErrors?", "retryable?" } }` with meaningful status codes (400/401/403/404/409/422/429/503). Tenant identity comes from the server session cookie - never from a caller-supplied merchant ID.

## Money invariants (tested)

- All money is **integer paise**. No floats touch stored amounts.
- Contribution = price - variable cost; margin = contribution / price; floor 25%.
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

## Verified locally

Recorded from an actual run on this machine (Windows 11, Node 24, npm 11):

- `npm run fixtures:verify` - all checks PASS
- `npm test` - 55 unit tests passing
- `npm run lint` / `npm run typecheck` - clean
- `npm run build` - production build succeeds
- `npm run test:e2e` - hero path passes (requires build first; first run downloads Chromium)

See `docs/VERIFICATION.md` for the exact observed output.

## Deployment notes (prototype scope)

This is a **single-process prototype**: SQLite needs a writable durable directory (a small VM or local machine; not
ephemeral serverless storage). For multi-instance production you would move the repository adapter to managed
PostgreSQL, add durable jobs, real authentication and rate limits, and per-tenant fixture isolation. That design is
future work, not something this build claims.

## Troubleshooting: "Cannot find module './NNN.js'" (dev server)

If the dev server shows `Server Error: Cannot find module './276.js'` (or a similar chunk number) after you ran
`npm run build`, the production build clobbered the dev server's `.next` cache — both share that folder and cannot run
at the same time. Fix: stop the dev server (`Ctrl+C`), delete `.next`, and start `npm run dev` again. Rule of thumb:
**never run `npm run build` while `npm run dev` is running** (use `npm run fixtures:verify` + `npm test` for quick
checks instead — they do not touch `.next`).

## Demo script (3 minutes)

1. 0:00-0:25 - the bakery's quiet afternoons; synthetic data label.
2. 0:25-0:55 - reveal the 30% decline; click evidence; matching windows and counts.
3. 0:55-1:25 - build the offer; inspect AI explanation and fixed offer math.
4. 1:25-1:55 - try Rs 50 -> rejection; restore Rs 70 -> approve the exact preview.
5. 1:55-2:20 - queue the simulated campaign; excluded contacts; activity trail.
6. 2:20-2:40 - apply redemptions; Rs 300 contribution; no causal-lift claim.
7. 2:40-3:00 - real integration path and next pilot (3-5 Pune bakery owners).
