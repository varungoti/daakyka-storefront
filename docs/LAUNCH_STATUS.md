# DAAKYKA Storefront — Launch Status

**Updated:** 2026-05-29  
**Staging:** https://storefront-nu-woad.vercel.app

## Done (101% code)

| Area | Status |
|------|--------|
| Storefront + admin (Phases 1–7) | ✅ |
| PostgreSQL production path | ✅ |
| Automated QA (198 tests) | ✅ |
| Staging deploy + remote verification | ✅ |
| Security hardening | ✅ |
| Handover docs | ✅ |

**Evidence:** `dogfood-output/COMPLETION.json` — `verify:101` + `verify:staging:full` passed.

## Live staging

| Item | Value |
|------|--------|
| URL | https://storefront-nu-woad.vercel.app |
| Admin | `/admin/login` |
| Vercel | `varubs-projects/storefront` |
| Neon | `misty-band-54920643` |

**Change the seed admin password after first login.**

## Blocked on credentials

| Step | Doc | Env vars |
|------|-----|----------|
| Shopify checkout | `SHOPIFY_SETUP.md` | `NEXT_PUBLIC_SHOPIFY_*`, `SHOPIFY_WEBHOOK_SECRET` |
| Email (Brevo) | `ENGAGEMENT_SETUP.md` | `BREVO_API_KEY` |
| WhatsApp (WATI) | `ENGAGEMENT_SETUP.md` | `WATI_API_KEY` |
| Production DNS | `GO_LIVE_RUNBOOK.md` | `daakyka.com` → Vercel |

## Manual before production

- Cross-browser QA on staging (`QA_CHECKLIST.md`)
- Stakeholder review of staging URL
- Admin password rotated from seed

## Verification commands

```bash
cd storefront

# Local full gate (docker compose up -d first)
npm run verify:101

# Live staging (198 tests on remote after next deploy re-seed)
npm run verify:staging:full

# After adding production env vars
npm run go-live:check -- --production
TEST_BASE_URL=https://daakyka.com npm run probe:deploy
```

## Explicitly excluded

AI Fit Scan
