# Handover Document — DAAKYKA Apparels Storefront

## Project Summary

Headless medical commerce storefront for **DAAKYKA Apparels** (Babaji Enterprises, Hyderabad). Built with Next.js 16, React 19, Tailwind v4, Prisma 7 + PostgreSQL.

**Staging (live):** https://storefront-nu-woad.vercel.app
**Explicitly excluded:** AI Fit Scan

## Repository

```
storefront/
├── src/app/          # Routes (storefront + admin + API)
├── src/components/   # UI components
├── src/lib/          # Auth, DB, Shopify, engagement, Hermes, SEO
├── src/data/         # Brand, products, SEO guides, navigation
├── prisma/           # Schema, migrations, seed
├── .github/workflows # CI (verify + E2E)
└── docs/             # Setup and launch guides
```

## Quick Start

```bash
cd storefront
npm install
cp .env.local.example .env
docker compose up -d
npm run db:setup
npm run dev
```

Admin: `http://localhost:3000/admin/login`
`npm run db:setup` prints the admin login it creates — see [ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md) for how credentials are seeded and rotated.

This local setup always talks to the Docker Postgres in `.env`'s `DATABASE_URL` — never the
production database (see below).

## How the system actually works today

- **Checkout**: Razorpay + this app's own Prisma/Postgres catalog — not Shopify.
  `POST /api/checkout` (`src/lib/orders/create-order.ts`) creates the order directly and re-prices
  every line server-side; `/api/checkout/verify` and `/api/webhooks/razorpay` confirm payment. With
  no Razorpay keys configured, checkout automatically falls back to an order-request flow (manual
  follow-up, no online payment) — that's a supported mode, not an error. Full detail:
  [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md).
- **Shopify** (`NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`/`..._STOREFRONT_ACCESS_TOKEN`) only switches on a
  **legacy, disconnected cart mode** (`src/lib/cart/service.ts`, `/api/cart`) that has never been
  wired to the real catalog (Shopify GIDs vs. this app's own product ids) or the real order
  pipeline above. It gates nothing required for launch and is slated for removal — don't configure
  it thinking it's the payment path.
- **Payments/email credentials can be admin-managed**: Razorpay and Brevo keys can be entered at
  `/admin/integrations` after deploy — encrypted at rest (`src/lib/integrations/credential-store.ts`,
  root key `CREDENTIAL_ENCRYPTION_KEY`) — instead of only via env vars. A value set there always
  wins over the env var for the same field, so either path works and you can switch later without a
  redeploy.
- **Database**: Supabase Postgres in production, connected through the **session pooler**
  specifically (port 5432) — the direct host and the transaction pooler are both IPv6-only
  (verified via DNS), which Vercel's runtime can't reach, so the session pooler is the only one of
  the three connection strings Supabase offers that actually works here. The password must be
  percent-encoded in the URL. Set on Vercel as `DATABASE_URL` (Prisma never reads
  `SUPABASE_DATABASE_URL` — that name is only how this repo's local `.env` keeps a reference copy
  of the production value, deliberately separate so local commands can't touch it by accident).
  Production has already been migrated and seeded.
- **Media**: Cloudflare R2, bucket `daakyka-media`, **not public**. Images are served same-origin
  through this app's own `/cdn/[...key]` route (`src/app/cdn/`), so `R2_PUBLIC_BASE_URL` is
  intentionally left unset.
- **Caching**: writes that call `revalidateTag(tag, "max")` (products, categories, settings, site
  images, size charts, credentials, reviews) serve one stale response on the next request, then are
  fresh after that — Next 16's documented stale-while-revalidate behavior, not a bug. Don't
  misread "still stale after one reload" as broken caching. (Homepage Hero/Trust-Stats/Announcement,
  Offers, and homepage Testimonials are a separate, genuine exception with no revalidation wired up
  yet — those need a redeploy to reflect an edit.)
- **AI image generation**: `npm run images:generate` (`scripts/generate-images.ts`) — costs real
  OpenAI spend per image, capped by `AI_IMAGE_DAILY_LIMIT` (default 50/day, site-wide). Always run
  with `--dry-run` first to see the plan and estimated cost before spending anything with `--yes`.
  Full detail: [IMAGES_AI.md](./IMAGES_AI.md). Founder portraits and real client logos are never
  AI-generated — they're `uploadOnly` slots in the image manifest, uploaded as real files from
  `/admin/media`.

## Documentation Index

| Doc | Purpose |
|---|---|
| [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) | **What's done vs blocked** |
| [README.md](../README.md) | Stack, scripts, phase status |
| [COMPLETION_STATUS.md](./COMPLETION_STATUS.md) | 101% completion map |
| [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md) | Staging → production steps |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Go-live steps |
| [QA_CHECKLIST.md](./QA_CHECKLIST.md) | Pre-launch QA |
| [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md) | Checkout flow, webhook, env vars |
| [SHOPIFY_SETUP.md](./SHOPIFY_SETUP.md) | Legacy cart mode (not checkout) — see note above |
| [ENGAGEMENT_SETUP.md](./ENGAGEMENT_SETUP.md) | Brevo + WATI + journeys |
| [IMAGES_AI.md](./IMAGES_AI.md) | AI image generation, cost cap, R2 storage |
| [HERMES_SETUP.md](./HERMES_SETUP.md) | Agent runtime |
| [HERMES_SECURITY.md](./HERMES_SECURITY.md) | Safety guardrails |
| [ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md) | Test admin email + client handover |
| [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) | Admin panel workflows |
| [SEO_GUIDE.md](./SEO_GUIDE.md) | SEO architecture |
| [HARDENING.md](./HARDENING.md) | Security & production controls |

## Credentials Required for Production

Hard-required (the app fails to boot on Vercel Production without these — see `validateEnv()` in
`src/lib/env.ts`):

- `DATABASE_URL` — Supabase Postgres, **session pooler** connection string (see above)
- `AUTH_SECRET` (≥ 32 chars), `CRON_SECRET`, `ADMIN_SEED_PASSWORD` (≥ 12 chars, not a default)
- `CREDENTIAL_ENCRYPTION_KEY` — 32 bytes, base64 or hex; root key for `/admin/integrations`
- `NEXT_PUBLIC_SITE_URL` — `https://` URL
- Razorpay's three vars, if using any of them, must all be set together (or none)

Optional, degrades gracefully without them: `R2_*` (or `CLOUDFLARE_*`) for media upload/AI images,
`OPENAI_API_KEY` for AI generation, `BREVO_API_KEY`/`WATI_API_KEY` for engagement. Full table with
every variable: [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md#environment-variables-what-is-actually-required).

Shopify credentials are **not** on this list — see "How the system actually works today" above.

## Automated Verification

```bash
npm run verify:101              # Local: db:setup, lint+typecheck+test+build, smoke, E2E,
                                 # dogfood E2E, then a Lighthouse audit against a real prod server
npm run verify:staging:full     # Live staging probe + remote tests
npm run go-live:check           # Partial env checklist before promote — see the caveat in
                                 # GO_LIVE_RUNBOOK.md (it doesn't check CREDENTIAL_ENCRYPTION_KEY)
```

## Key Acceptance Criteria (Part 19)

| Criterion | Status |
|---|---|
| Premium storefront + shop + product pages | ✅ |
| Admin RBAC + CMS + bulk leads | ✅ |
| 21 SEO guides + schema | ✅ |
| Customer journeys (scheduler) | ✅ — needs cron + providers for live send |
| Hermes approval queue | ✅ — runtime optional |
| Weekly growth report | ✅ `/admin/reports` |
| Production hardening + automated test suite | ✅ |
| Staging deploy verified | ✅ https://storefront-nu-woad.vercel.app |
| Checkout (Razorpay, DB-native) | ✅ — works today; online payment needs Razorpay keys (env var or `/admin/integrations`), otherwise falls back to order-request |
| Live email/WhatsApp | ⏳ Needs Brevo (env var or `/admin/integrations`) / WATI |
| Production DNS | ⏳ `daakyka.com` — that domain is currently unreachable from this dev environment (it hosts an unrelated old site today; see `src/data/media/catalog.ts`'s doc comment), separate from whether it's pointed at this app yet |

**Full status:** [LAUNCH_STATUS.md](./LAUNCH_STATUS.md)

## Support Contacts

- Brand site: [daakyka.com](https://daakyka.com) — unreachable from this dev environment as of
  2026-09-20 (DNS resolves; every connection attempt times out). Confirm current status before
  assuming it's back, and don't hotlink assets from it — see `src/data/media/catalog.ts`.
- Master plan: `/Proposal/DAAKYKA_AUTONOMOUS_STORE_MASTER_PLAN.md`

## Post-Handover Maintenance

- Weekly: review `/admin/reports`, approve Hermes queue, follow bulk leads
- Monthly: SEO audit in admin, refresh blog, check integration status
- Rotate admin password and API keys quarterly
