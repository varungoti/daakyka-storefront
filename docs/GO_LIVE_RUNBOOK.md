# Go-Live Runbook — DAAKYKA Storefront

**Code status: 101% complete.** This runbook covers the only remaining steps — all require your credentials.

## Phase A — Staging (1–2 hours)

### A1. Database (Neon or Supabase)

1. Create a **staging** Postgres database.
2. Copy connection string → Vercel env `DATABASE_URL`.
3. Run migrations on first deploy (handled by `vercel.json` build command).

### A2. Vercel project

1. Import repo; set **Root Directory** = `storefront`.
2. Add env vars from `.env.staging.example`.
3. Deploy preview/staging branch.

```bash
# After deploy — from storefront/
npm run check:deploy-env
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run probe:deploy -- --staging
TEST_BASE_URL=https://YOUR-STAGING-URL.vercel.app npm run verify:staging -- --dogfood
```

### A3. Staging checklist

- [ ] Admin login works; **change seed password**
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] `robots.txt` disallows indexing
- [ ] Complete manual items in `QA_CHECKLIST.md` on staging URL

---

## Phase B — Integrations (when ready)

| Service | Env vars | Doc |
|---------|----------|-----|
| Shopify | `NEXT_PUBLIC_SHOPIFY_*`, `SHOPIFY_WEBHOOK_SECRET` | `SHOPIFY_SETUP.md` |
| Brevo email | `BREVO_API_KEY`, `BREVO_FROM_EMAIL` | `ENGAGEMENT_SETUP.md` |
| WATI WhatsApp | `WATI_API_KEY`, `WATI_API_URL` | `ENGAGEMENT_SETUP.md` |
| Cron jobs | `CRON_SECRET` | `vercel.json` crons |

Test order flow → webhook → `/admin/orders` → post-purchase journey.

---

## Phase C — Production

1. Copy staging env to production with production secrets.
2. Set `NEXT_PUBLIC_SITE_URL=https://daakyka.com`.
3. Remove `NEXT_PUBLIC_ALLOW_INDEXING=false` (or set `true`).
4. Point DNS to Vercel.
5. Submit `https://daakyka.com/sitemap.xml` to Google Search Console.
6. Run `npm run probe:deploy` against production URL.

---

## Verification commands

| Command | When |
|---------|------|
| `npm run verify:101` | Before every merge to staging/main |
| `npm run check:deploy-env` | Before promoting env vars |
| `npm run probe:deploy -- --staging` | After staging deploy |
| `npm run verify:staging -- --dogfood` | Full remote QA |

---

## Handover

| Audience | Document |
|----------|----------|
| Developer | `HANDOVER.md`, `COMPLETION_STATUS.md` |
| Admin user | `ADMIN_GUIDE.md` |
| Marketing/SEO | `SEO_GUIDE.md` |
| Launch owner | `LAUNCH_CHECKLIST.md` |

**Support:** `varungoti@gmail.com` (test seed) — swap via `docs/ADMIN_CREDENTIALS.md` before client go-live.
