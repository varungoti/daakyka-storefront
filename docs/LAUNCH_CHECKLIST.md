# DAAKYKA Storefront — Launch Checklist

Checkout is **Razorpay + this app's own Postgres/Prisma catalog, not Shopify** — see
[GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md) and [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md) for
the full flow. The Shopify env vars below only switch on a legacy, disconnected cart mode that was
never wired to the real catalog or order pipeline — they gate nothing required for launch and are
slated for removal. Don't treat them as blocking.

## 1. Environment

Production values, one at a time:

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Supabase Postgres in production — must be the **session pooler** connection string (port 5432; the direct host and transaction pooler are IPv6-only, which Vercel's runtime can't reach). Percent-encode the password. Set on Vercel as `DATABASE_URL` — Prisma never reads `SUPABASE_DATABASE_URL`, which is only how this repo's local `.env` keeps a reference copy of the production value. |
| `AUTH_SECRET` | **Yes** | ≥ 32 random characters |
| `CREDENTIAL_ENCRYPTION_KEY` | **Yes** | 32 bytes (base64 or hex) — root key for `/admin/integrations` credential encryption. Not checked by `npm run check:deploy-env`; don't rely on that script alone. |
| `CRON_SECRET` | **Yes** | Protects `/api/cron/*` |
| `ADMIN_SEED_PASSWORD` | **Yes** | ≥ 12 chars, not a known default |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | `https://daakyka.com` (or wherever DNS currently points) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | For online payment | All three or none — can also be set later via `/admin/integrations` instead of a redeploy |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | For image upload/AI generation | `CLOUDFLARE_*` names also work — see `src/lib/storage/r2.ts` |
| `R2_PUBLIC_BASE_URL` | **Leave unset** | The R2 bucket is private; media is served same-origin via `/cdn/[...key]`. Only set this if the bucket is ever made public. |
| `OPENAI_API_KEY` / `AI_IMAGE_DAILY_LIMIT` | For AI image generation | Costs real money per image — see [IMAGES_AI.md](./IMAGES_AI.md). Default cap is 50/day site-wide. |
| `BREVO_API_KEY` | For email journeys | Or set later via `/admin/integrations` |
| `WATI_API_KEY` | For WhatsApp | |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` / `..._STOREFRONT_ACCESS_TOKEN` | Legacy cart mode only | Not needed for launch — see above |
| `DB_POOL_MAX` | Optional | Defaults to 5; keep small with a connection pooler |
| `HERMES_API_URL` / `HERMES_API_KEY` | Optional | Agent runtime |

Run migrations and seed the admin user (this also runs automatically on every Vercel deploy via
`scripts/vercel-build.mjs`):

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

`prisma/seed.ts` only ever creates the admin user — it never overwrites an existing one — so
re-running it is always safe. Change the seed password immediately after first login regardless.

## 2. Payments (Razorpay)

Checkout works without any of this — it falls back to an order-request flow (manual follow-up, no
online payment) when Razorpay isn't configured. To enable real online payment:

1. Get live-mode API keys from the [Razorpay Dashboard](https://dashboard.razorpay.com/) (Settings
   → API Keys).
2. Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` as env vars, **or** enter them at
   `/admin/integrations` after deploy (encrypted at rest; no redeploy needed; a value entered there
   always wins over the env var).
3. Register a webhook (Settings → Webhooks) pointed at
   `https://<your-production-domain>/api/webhooks/razorpay`, subscribed to at least
   `payment.captured`, `payment.failed`, `refund.processed`. Copy its signing secret into
   `RAZORPAY_WEBHOOK_SECRET` (env var — the webhook secret is not currently settable from
   `/admin/integrations`, only the two API keys are).
4. Place a real test order — verify `/admin/orders` and the post-purchase journey enrollment.

Full detail, including the stock-decrement/idempotency design: [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md).

## 3. Media (Cloudflare R2)

- [ ] R2 credentials set (env vars or `CLOUDFLARE_*` fallback — see above)
- [ ] `R2_PUBLIC_BASE_URL` left **unset** (bucket is private by design; `/cdn/[...key]` serves it)
- [ ] Founder portraits, client logos, and any other `uploadOnly` slots uploaded from
      `/admin/media` — these are never AI-generated (see [IMAGES_AI.md](./IMAGES_AI.md))
- [ ] If using AI-generated site imagery, run `npm run images:generate -- --dry-run` first to see
      the plan and estimated cost before spending anything with `--yes`

## 4. Engagement

1. Add Brevo API key + verified sender domain (env var or `/admin/integrations`)
2. Add WATI API key for WhatsApp templates
3. Approve campaign templates in `/admin/templates`
4. `CRON_SECRET` is set (required, not optional) — verify Vercel crons in `vercel.json`:
   - Journeys: daily on Vercel Hobby (`0 9 * * *`); hourly on Pro (`0 * * * *`)
   - Hermes: daily 06:00 UTC · Reports: weekly Monday 07:00 UTC · Cancel-stale-orders: every 15 min
5. Test the welcome journey via newsletter signup
6. Test abandoned cart (requires an email captured in the cart session)

## 5. SEO

- [ ] Submit sitemap: `https://<your-production-domain>/sitemap.xml`
- [ ] Verify `robots.txt` allows crawling (and that `NEXT_PUBLIC_ALLOW_INDEXING` isn't left `false`)
- [ ] Google Search Console property verified
- [ ] Rich Results Test on homepage, product, guide page
- [ ] All schema checks green in `/admin/seo`

## 6. QA

Automated QA is **complete** — run `npm run verify:101` and confirm `dogfood-output/COMPLETION.json`.

Complete remaining **manual** items in [QA_CHECKLIST.md](./QA_CHECKLIST.md) on the staging URL.

**Caching note:** a write that calls `revalidateTag(tag, "max")` (products, categories, settings,
site images, size charts, credentials, reviews) serves **one stale response on the very next
request** after the save, then is fresh from the request after that — that's Next 16's documented
stale-while-revalidate behavior, not a bug. If a reload right after saving still looks stale,
reload once more before filing it. (Homepage Hero/Trust-Stats/Announcement/Offers/Testimonials are
a separate, real exception — they currently have no revalidation at all and need a redeploy to
update; see `GO_LIVE_RUNBOOK.md`.)

## 7. Monitoring

- [ ] Error tracking (Sentry) connected
- [ ] Uptime monitor on `/api/health` (not cron URLs)
- [ ] Admin audit logs reviewed weekly

## 8. Go-Live

- [ ] DNS pointed to Vercel
- [ ] SSL certificate active
- [ ] 301 redirects verified (SEO paths → `/guides/*`)
- [ ] Announcement bar copy finalized
- [ ] Homepage hero CMS updated for launch messaging (requires a redeploy to appear — see caching
      note in §6)
- [ ] Team trained on admin panel

## Post-Launch (Week 1)

- Monitor `/admin/orders`, contact enquiries, bulk leads
- Review journey enrollments in `/admin/journeys`
- Check `/admin/reputation` for review gap follow-ups
- Hermes tasks remain **approval-only** — never enable autonomous publish without review
