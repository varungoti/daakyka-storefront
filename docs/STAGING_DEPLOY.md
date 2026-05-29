# Staging Deployment — DAAKYKA Storefront

Deploy a staging environment before production go-live (master plan Phase 7).

## Recommended: Vercel

1. Import the `storefront` directory as a Vercel project (or monorepo root with **Root Directory** = `storefront`).
2. Create a **Preview** branch deployment from `staging` or `main`.
3. Set environment variables (use staging values, not production secrets):

| Variable | Staging value |
|----------|---------------|
| `DATABASE_URL` | Neon/Supabase **staging** Postgres URL |
| `AUTH_SECRET` | Unique staging secret (32+ chars) |
| `NEXT_PUBLIC_SITE_URL` | `https://staging.daakyka.com` or Vercel preview URL |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `false` (blocks robots + meta noindex; Vercel preview also auto-blocks) |
| `CRON_SECRET` | Staging cron bearer token |
| `ADMIN_SEED_PASSWORD` | Strong password (re-seed or change after deploy) |

4. Run migrations on deploy:

```bash
npx prisma migrate deploy
```

Copy `.env.staging.example` into Vercel staging env vars. Validate before promote:

```bash
# Load staging env in shell, then:
npm run check:deploy-env
TEST_BASE_URL=https://your-staging.vercel.app npm run probe:deploy -- --staging
```

Add to Vercel **Build Command** (optional):

```bash
prisma generate && prisma migrate deploy && next build
```

5. Verify crons in `vercel.json` fire against staging URL with `CRON_SECRET`.

> **Vercel Hobby:** cron schedules are limited to once per day. This repo uses daily journey runs (`0 9 * * *`). For hourly journeys, upgrade to Pro and change `vercel.json` to `0 * * * *`.

## Post-deploy verification

```bash
# One-command staging verification (smoke + core E2E)
TEST_BASE_URL=https://your-staging.vercel.app npm run verify:staging

# Include dogfood crawl
TEST_BASE_URL=https://your-staging.vercel.app npm run verify:staging -- --dogfood

# Full local gate before merge
npm run verify:101
```

See also [HARDENING.md](./HARDENING.md) for security headers, rate limits, and `/api/health`.

## Staging checklist (2026-05-29)

**URL:** https://storefront-nu-woad.vercel.app

- [x] Admin login works *(remote dogfood admin tour)*
- [ ] Admin password changed from seed
- [x] All 21 guide pages return 200 *(smoke + dogfood)*
- [ ] Shopify test store connected (optional)
- [ ] Webhook URL points to staging domain
- [ ] Brevo/WATI use sandbox or test lists only
- [x] `GET /api/health` returns `{ status: "ok" }`
- [x] `robots.txt` disallows indexing
- [x] Automated QA on staging URL (`npm run verify:staging:full`)
- [ ] Team completes manual items in `docs/QA_CHECKLIST.md`

## Branch strategy (Part 18)

| Branch | Purpose |
|--------|---------|
| `main` | Production |
| `staging` | QA and client review |
| `feature/*` | Feature work |

Merge: `feature/*` → `staging` → `main` after `npm run verify:101` passes.
