# Production Hardening Guide

Hardening controls added for Phase 7 launch readiness. All items below work without live Shopify/Brevo/WATI credentials.

## Environment validation

`src/lib/env.ts` runs at build (`next.config.ts`) and server startup (`src/instrumentation.ts`).

| Variable | Production requirement |
|----------|------------------------|
| `AUTH_SECRET` | ≥ 32 characters |
| `DATABASE_URL` | Postgres URL (not `file:`) |
| `CRON_SECRET` | Required |
| `SHOPIFY_WEBHOOK_SECRET` | Required when Shopify Storefront env vars are set |

## Staging / preview noindex

Set either:

- `NEXT_PUBLIC_ALLOW_INDEXING=false` on staging deployments, or
- Deploy as Vercel Preview (`VERCEL_ENV=preview` auto-blocks indexing)

Effects:

- `robots.txt` → `Disallow: /`
- Root layout `robots` meta → `noindex, nofollow`

## Security headers

Applied globally via `next.config.ts`:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (camera/mic/geo disabled)
- `X-DNS-Prefetch-Control: on`
- `Strict-Transport-Security` (Vercel production only)

Session cookies use `secure` only when `NEXT_PUBLIC_SITE_URL` starts with `https://` (override with `COOKIE_SECURE=false` if needed). See `shouldUseSecureSessionCookie()` in `session-cookie.ts`.

## Rate limiting

In-memory sliding window on public write endpoints (`src/lib/security/rate-limit.ts`):

| Route | Limit |
|-------|-------|
| `/api/auth/login` | 5 / minute / IP |
| `/api/contact` | 5 / minute |
| `/api/bulk-orders` | 5 / minute |
| `/api/newsletter/subscribe` | 10 / minute |
| `/api/analytics/product-view` | 60 / minute |

Disabled when `NODE_ENV=test` or `DISABLE_RATE_LIMIT=1`.

| `/api/cart/abandon` | 10 / minute |

## Admin API protection

- **Middleware** guards `/admin/*` pages and `/api/admin/*` routes — invalid/missing session cookie → redirect (pages) or **401** (API).
- **Route handlers** enforce RBAC via `requireAdminPermission()` — missing session → **401**, insufficient role → **403**.
- Admin write routes use `readJsonBody()` (64 KB limit).

## Request body limits

Public write APIs parse JSON via `readJsonBody()` (`src/lib/security/parse-json-body.ts`):

- Max body size: **64 KB**
- Oversized payloads → **413 Payload Too Large**
- Invalid JSON → **400**

Applied to: login, contact, bulk-orders, newsletter, cart, cart abandon, product-view analytics, and **all** `/api/admin/*` write routes.

## Cart degradation

When Shopify Storefront is configured but the cart API fails, `/api/cart` returns:

```json
{ "mode": "degraded", "fallback": "local", "error": "..." }
```

The cart provider falls back to localStorage demo cart so demos and QA continue without a hard 500.

## Shopify webhook verification

HMAC validation lives in `src/lib/shopify/webhook-verify.ts`:

- Production with `SHOPIFY_WEBHOOK_SECRET` set → unsigned/invalid payloads return **401**
- Development without secret → unsigned payloads allowed for local testing

## Health check

`GET /api/health` returns:

- Database connectivity
- Catalog source (`seed` or `shopify`)
- Integration provider statuses

Use for uptime monitoring instead of cron URLs.

## Error pages

Branded fallbacks:

- `src/app/error.tsx` — recoverable errors
- `src/app/not-found.tsx` — 404
- `src/app/global-error.tsx` — root layout failures

## SEO completeness

`sitemap.xml` includes:

- All marketing/landing pages
- Product PDPs (`/products/[handle]`)
- Guides, collections, blog posts

## Verification commands

```bash
# Full local gate (build + server tests via predeploy script)
npm run verify:predeploy

# Unit + integration + build only
npm run verify:101

# Against deployed staging
TEST_BASE_URL=https://your-staging.vercel.app npm run verify:staging
TEST_BASE_URL=https://your-staging.vercel.app npm run verify:staging -- --dogfood

# Lighthouse (dev server required)
npm run dev
npm run audit:lighthouse
```

## Still manual / credential-gated

- Sentry DSN (optional — not wired yet)
- Distributed rate limiting (Redis) for multi-instance production
- Shopify live cart/checkout
- Brevo/WATI live sends
- Hermes NousResearch runtime

See also: [STAGING_DEPLOY.md](./STAGING_DEPLOY.md), [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).
