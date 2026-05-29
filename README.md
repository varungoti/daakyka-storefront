# DAAKYKA Apparels Storefront

Premium headless medical commerce storefront for DAAKYKA Apparels.

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **Tailwind CSS v4**
- **Framer Motion**
- **Prisma 7** + SQLite (local) / Postgres (production)
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

Default admin credentials (change after first login):

- Email: `varungoti@gmail.com`
- Password: `Daakyka@2026` (change after first login; swap to client credentials via env — see `docs/ADMIN_CREDENTIALS.md`)

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
| `npm run verify:staging:full` | Live staging probe + smoke + E2E + dogfood |
| `npm run verify:predeploy` | Pre-deploy gate (build + smoke + e2e + dogfood) |
| `npm run verify:staging` | Smoke + E2E against deployed URL |
| `npm run verify:staging:full` | Probe + smoke + E2E + dogfood on live staging |
| `npm run go-live:check` | Env checklist + next steps for staging/production |
| `npm run bootstrap:staging` | Generate staging secrets + env template |
| `npm run check:deploy-env` | Validate staging env vars before deploy |
| `npm run probe:deploy` | Post-deploy health + security probe |
| `npm run audit:lighthouse` | Lighthouse scores for key pages |
| `npm run lint` | Run ESLint |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed admin user, homepage sections, blog posts |
| `npm run db:setup` | Migrate + seed in one step |

## Environment

Copy `.env.local.example` to `.env` (or `.env.local`):

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET=your-long-random-secret
ADMIN_SEED_EMAIL=varungoti@gmail.com
ADMIN_SEED_PASSWORD=change-me

NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=your-token
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

Credential-blocked for production go-live: Shopify, Brevo, WATI, Postgres deploy. See `docs/COMPLETION_STATUS.md`.

**Note:** AI Fit Scan is intentionally excluded from the current build.

## Phase Status

- **Phase 1** — Storefront MVP ✅
- **Phase 2** — Advanced storefront (cart, search, wishlist, mix & match, blog, fabric tech) ✅
- **Phase 3** — Admin panel (auth, RBAC, CMS, bulk orders, audit logs) ✅
- **Phase 4** — Engagement engine (journeys, campaigns, SEO manager, intelligence) ✅
- **Phase 5** — Hermes agent on Vercel (inline runtime + Fireworks) ✅
- **Part 10 SEO** — 21 guide pages + `/guides` hub + fabric-tech redirects ✅
- **Phase 7 QA** — 194 automated tests, CI, dogfood, hardening, verify:101 ✅
- **Next** — Staging deploy + live credentials + manual cross-browser QA

### Hermes Agent (Vercel)

Hermes runs inline on Vercel — no separate server required. See `docs/HERMES_VERCEL.md`.

```env
HERMES_RUNTIME_INLINE=1
FIREWORKS_API_KEY=fw_...
HERMES_DEFAULT_MODE=SUGGEST_ONLY
```

Health: `GET /api/hermes/runtime/health` · Admin: `/admin/hermes`

### Cart Modes
- **Demo mode** (default): localStorage cart
- **Shopify mode**: set Shopify env vars — cart uses Storefront API and Shopify checkout

### Currency
- Base currency: **INR (₹)** with USD toggle in header
