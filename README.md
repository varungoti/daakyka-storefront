# DAAKYKA Apparels Storefront

Premium headless medical commerce storefront for DAAKYKA Apparels.

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **Tailwind CSS v4**
- **Framer Motion**
- **Prisma 7** + Postgres (local via `docker compose up -d postgres`, and production)
- **Lucide React** (icons)

## Getting Started

```bash
npm install
cp .env.local.example .env
docker compose up -d
npm run db:setup
npm run dev
```

- Storefront: http://localhost:3000
- Admin panel: http://localhost:3000/admin/login

`npm run db:setup` prints the admin login it just created (from your
`.env`'s `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`, or a randomly
generated password if you left `ADMIN_SEED_PASSWORD` unset). See
`docs/ADMIN_CREDENTIALS.md` for how this works and how to rotate it —
on Vercel, a real `ADMIN_SEED_PASSWORD` is required before the first
deploy will even build.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Generate Prisma client + production build |
| `npm run start` | Start production server |
| `npm run test` | Unit + integration tests |
| `npm run test:smoke` | HTTP smoke tests (server required) |
| `npm run test:e2e` | Core Playwright E2E (server required) |
| `npm run test:dogfood` | Full exploratory crawl (51 tests) |
| `npm run verify` | Lint + test + build |
| `npm run verify:101` | **101% gate** — predeploy + Lighthouse |
| `npm run verify:predeploy` | Pre-deploy gate (build + smoke + e2e + dogfood) |
| `npm run verify:staging` | Smoke + E2E against a Preview/staging URL (`TEST_BASE_URL`); refuses production |
| `npm run verify:staging:full` | Probe + smoke + E2E + dogfood on a Preview/staging URL (`TEST_BASE_URL`, no default). The suites write data, so it refuses the production store; `-- --production-readonly` runs only GET-only checks against production |
| `npm run go-live:check` | Env checklist + next steps for staging/production |
| `npm run bootstrap:staging` | Generate staging secrets + env template |
| `npm run check:deploy-env` | Validate staging env vars before deploy |
| `npm run probe:deploy` | Post-deploy health + security probe (GET-only; `-- --write-probes` adds the try-on POST, staging only) |
| `npm run audit:lighthouse` | Lighthouse scores for key pages |
| `npm run lint` | Run ESLint |
| `npm run db:migrate` | **Dev only** — `prisma migrate dev`; can reset the database. Never run against production (use `prisma migrate deploy`, e.g. via `db:setup` or `scripts/go-live.mjs`) |
| `npm run db:seed` | Seed admin user, homepage sections, blog posts |
| `npm run db:setup` | `prisma migrate deploy` + seed in one step — safe for production |

### Where tests may run

`npm test`, `verify:101` and `verify:predeploy` create and delete orders, customers and admin users, so
they refuse to start unless `DATABASE_URL` (and `MIGRATION_DATABASE_URL`) is a local database —
`localhost`, `127.0.0.1`, `::1` or the compose service `postgres` — and never the production Supabase
database (`SUPABASE_DATABASE_URL`, or any `*.supabase.co/.com` host). Set `ALLOW_REMOTE_TEST_DB=1` only for a
remote database that is genuinely disposable; it never lifts the production refusal. The Playwright config
loads `.env` like the tsx test scripts do. Browser tests that write data only run against a local server
(or a staging deployment with `E2E_ALLOW_MUTATIONS=1`), and never against production. Mix & Match and Fabric
Technology are off by default, so the dogfood and smoke suites expect them to 404; set
`CI_OPTIONAL_PAGES_ENABLED=1` when they are switched on.

## Environment

Copy `.env.local.example` to `.env` (or `.env.local`):

```env
DATABASE_URL="postgresql://daakyka:daakyka@localhost:5432/daakyka_dev"
AUTH_SECRET=your-long-random-secret
ADMIN_SEED_EMAIL=admin@example.com
ADMIN_SEED_PASSWORD=change-me

NEXT_PUBLIC_USD_TO_INR_RATE=83
```

## Admin Panel (Phase 3)

| Route | Purpose |
|---|---|
| `/admin/dashboard` | Overview widgets + recent activity |
| `/admin/homepage` | Edit hero copy |
| `/admin/blog` | Blog CMS (create, edit, publish) |
| `/admin/bulk-orders` | Manage hospital/team lead enquiries |
| `/admin/audit-logs` | Admin action history |

RBAC roles: Super Admin, Store Owner, Marketing Admin, SEO Manager, Content Editor, Bulk Order Manager, Viewer.

## Project Structure

- `src/app/` — Storefront + admin routes
- `src/components/home/` — Homepage sections
- `src/components/admin/` — Admin UI
- `src/lib/` — Auth, DB, Shopify, CMS helpers
- `prisma/` — Schema, migrations, seed

## Design Reference

Layout follows mockup images in `/Source Images` and the master plan at `/Proposal/DAAKYKA_AUTONOMOUS_STORE_MASTER_PLAN.md`.

**Docs:** `docs/COMPLETION_STATUS.md`, `docs/HANDOVER.md`, `docs/HARDENING.md`, `docs/LAUNCH_CHECKLIST.md`, ...

## 101% Completion

All planned features, hardening, and **194 automated tests** are complete. Run:

```bash
npm run verify:101
```

Credential-blocked for production go-live: Brevo, WATI, Postgres deploy. See `docs/COMPLETION_STATUS.md`.

**Note:** AI Fit Scan is intentionally excluded from the current build.

## Phase Status

- **Phase 1** — Storefront MVP ✅
- **Phase 2** — Advanced storefront (cart, search, wishlist, mix & match, blog, fabric tech) ✅
- **Phase 3** — Admin panel (auth, RBAC, CMS, bulk orders, audit logs) ✅
- **Phase 4** — Engagement engine (journeys, campaigns, SEO manager, intelligence) ✅
- **Phase 5** — Hermes agent on Vercel (inline runtime + Fireworks) ✅
- **Part 10 SEO** — 21 guide pages + `/guides` hub + fabric-tech redirects ✅
- **Phase 7 QA** — 194 automated tests, CI, dogfood, hardening, verify:101 ✅
- **Deployed** — Production live at https://storefront-nu-woad.vercel.app
- **Next** — Razorpay/Brevo/WATI live credentials, `daakyka.com` DNS cutover, manual cross-browser QA (see `docs/LAUNCH_STATUS.md`)

### Hermes Agent (Vercel)

Hermes runs inline on Vercel — no separate server required. See `docs/HERMES_VERCEL.md`.

```env
HERMES_RUNTIME_INLINE=1
FIREWORKS_API_KEY=fw_...
HERMES_DEFAULT_MODE=SUGGEST_ONLY
```

Health: `GET /api/hermes/runtime/health` · Admin: `/admin/hermes`

### Cart
localStorage-backed cart (no external cart/checkout service). Checkout is native —
Razorpay online payment with an order-request fallback when it's unconfigured; see
`docs/PAYMENTS_RAZORPAY.md`.

### Currency
- Base currency: **INR (₹)** with USD toggle in header
