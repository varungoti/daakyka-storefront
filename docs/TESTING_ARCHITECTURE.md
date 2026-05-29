# Testing Architecture — DAAKYKA Storefront

Four layers, run in CI and locally before launch.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — Dogfood / Exploratory (manual + Playwright E2E)  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3 — Smoke (HTTP against running server)              │
├─────────────────────────────────────────────────────────────┤
│  Layer 2 — Integration (API route handlers + DB)            │
├─────────────────────────────────────────────────────────────┤
│  Layer 1 — Unit (pure logic, schemas, RBAC, SEO helpers)    │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1 — Unit Tests

**Runner:** Node.js built-in `node:test` via `tsx --test`  
**Location:** `src/**/*.test.ts`  
**Scope:** RBAC, currency, SEO audit, JSON-LD validation, Zod schemas, Hermes safety, report formatting

```bash
npm run test:unit
```

**Coverage targets:** auth helpers, pricing, SEO helpers, validation schemas, permission checks (Part 16).

## Layer 2 — Integration Tests

**Runner:** `tsx --test`  
**Location:** `tests/integration/**/*.test.ts`  
**Scope:** API route handlers invoked directly with `Request` objects; uses seeded SQLite dev DB

```bash
npm run test:integration
```

**Cases:**
- Public APIs return expected status codes
- Validation rejects bad payloads
- Cron endpoints enforce auth when `CRON_SECRET` is set
- Admin login accepts seed credentials

## Layer 3 — Smoke Tests

**Runner:** `tsx --test` against `TEST_BASE_URL` (default `http://localhost:3000`)  
**Location:** `tests/smoke/**/*.test.ts`  
**Requires:** Running server (`npm run dev` or `npm run start`)

```bash
npm run test:smoke
```

**Cases:**
- All critical storefront pages return HTTP 200
- Sitemap and robots.txt accessible
- API `/api/products` returns JSON array
- SEO guide pages render
- Admin login page loads

## Layer 4 — E2E (Playwright)

**Runner:** `@playwright/test`  
**Location:** `tests/e2e/**/*.spec.ts`  
**Requires:** Server at `PLAYWRIGHT_BASE_URL`

```bash
npm run test:e2e
```

**Flows (Part 16 E2E plan):**
- Homepage → shop → product → add to cart → checkout
- Guides hub and guide page
- Admin login → dashboard → reports → SEO
- Newsletter form validation
- Bulk order form

## Full Verification Pipeline

```bash
npm run verify          # lint + unit + integration + build
npm run verify:full     # verify + smoke + core e2e (server must be running)
npm run verify:predeploy   # full gate: build + smoke + e2e + dogfood (starts server)
npm run verify:101         # lint + unit + integration + build + smoke + e2e + dogfood (server required for smoke+)
npm run test:dogfood    # Playwright dogfood suite only
```

## CI Recommendation (GitHub Actions)

```yaml
jobs:
  verify:
    steps:
      - npm ci
      - npm run db:setup
      - npm run verify
      - npm run start &
      - npx wait-on http://localhost:3000
      - npm run test:smoke
      - npx playwright install --with-deps
      - npm run test:e2e
```

## Dogfood (Exploratory QA)

Automated dogfood via Playwright (`tests/e2e/dogfood.spec.ts`):
- **51 tests** — storefront crawl (20 routes + 21 guides), interactive flows, admin tour (single login)
- Console error checks on every storefront page
- Screenshots saved to `dogfood-output/screenshots/`
- Report: `dogfood-output/report.md`

```bash
npm run test:dogfood    # requires server at PLAYWRIGHT_BASE_URL
```

Manual checklist: `docs/QA_CHECKLIST.md` — run after automated layers pass for cross-browser/mobile.

## Safety Tests (Part 16)

| Test | Layer |
|---|---|
| Unauthorized admin blocked | E2E + middleware |
| Hermes cannot publish without approval | Unit + integration |
| RBAC enforced | Unit + E2E admin |
| Cron auth in production | Integration |
| Shopify webhook HMAC | Unit + integration |
| Security headers | Smoke |
| Cart local/degraded mode | Integration |

## What Is Not Tested Automatically

- Live Shopify checkout (requires credentials)
- Brevo/WATI delivery (requires API keys)
- Hermes NousResearch runtime (stub mode tested)
- Cross-browser matrix (Playwright uses Chromium by default; extend config for Firefox/WebKit)

## Adding Tests

1. **New utility** → `src/lib/foo.test.ts` next to source
2. **New API route** → add case in `tests/integration/api-routes.test.ts`
3. **New page** → add URL to `tests/smoke/pages.test.ts` and E2E spec if user-facing flow
