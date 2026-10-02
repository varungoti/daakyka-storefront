# DAAKYKA Storefront — Launch Status

**Updated:** 2026-09-26
**Production:** https://storefront-nu-woad.vercel.app

## Done (101% code)

| Area | Status |
|------|--------|
| Storefront + admin (Phases 1–7) | ✅ |
| PostgreSQL production path | ✅ |
| Automated QA (198 tests) | ✅ |
| Production deploy + remote verification | ✅ |
| Security hardening | ✅ |
| Handover docs | ✅ |

**Evidence:** `dogfood-output/COMPLETION.json` — `verify:101` + `verify:staging:full` passed.

## Live production

| Item | Value |
|------|--------|
| URL | https://storefront-nu-woad.vercel.app |
| Admin | `/admin/login` |
| Vercel | `varubs-projects/storefront` |
| Database | Supabase Postgres, **session pooler** connection (see [HANDOVER.md](./HANDOVER.md)) |
| Media | Cloudflare R2 bucket `daakyka-media`, private, served via `/cdn/[...key]` |

**Change the seed admin password after first login.**

## Blocked on credentials / config

| Step | Doc | Env vars |
|------|-----|----------|
| Online payment (Razorpay) | `PAYMENTS_RAZORPAY.md`, `LAUNCH_CHECKLIST.md` §3 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (or set via `/admin/integrations`) — checkout works without these via the order-request fallback |
| Email (Brevo) | `ENGAGEMENT_SETUP.md` | `BREVO_API_KEY` (or via `/admin/integrations`) |
| WhatsApp (WATI) | `ENGAGEMENT_SETUP.md` | `WATI_API_KEY` |
| Production DNS cutover | `GO_LIVE_RUNBOOK.md` | `daakyka.com` still resolves to the old Hostinger site, not this Vercel project |
| Search indexing | `LAUNCH_CHECKLIST.md` §6 | production must **not** have `NEXT_PUBLIC_ALLOW_INDEXING=false` left set (`src/lib/env.ts`'s `isIndexingAllowed()`) |

There is no Shopify integration blocking anything — checkout is Razorpay + this app's own catalog;
see "How the system actually works today" in [HANDOVER.md](./HANDOVER.md).

## Manual before full go-live

- Cross-browser QA (`QA_CHECKLIST.md`)
- Admin password rotated from seed
- Confirm production robots.txt/meta allow indexing once ready for search engines

## Verification commands

```bash
cd storefront

# Local full gate (docker compose up -d first)
npm run verify:101

# Remote tests against a Preview/staging deployment — never production, they write data.
# Production only gets the GET-only checks: `... npm run verify:staging:full -- --production-readonly`
TEST_BASE_URL=https://<preview-or-staging-host> npm run verify:staging:full

# After adding production env vars
npm run go-live:check -- --production
# Use the actual live production host — daakyka.com still serves the old
# Hostinger site until GO_LIVE_RUNBOOK.md's Domain & DNS cutover is done.
TEST_BASE_URL=https://storefront-nu-woad.vercel.app npm run probe:deploy
```

## Explicitly excluded

AI Fit Scan
