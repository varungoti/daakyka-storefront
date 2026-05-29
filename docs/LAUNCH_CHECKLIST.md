# DAAKYKA Storefront — Launch Checklist

## 1. Environment

Copy `.env.local.example` → production env (Vercel/Railway):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres in production (not SQLite) |
| `AUTH_SECRET` | Yes | Long random string |
| `NEXT_PUBLIC_SITE_URL` | Yes | `https://daakyka.com` |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | For live commerce | `your-store.myshopify.com` |
| `NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` | For live commerce | Storefront API token |
| `SHOPIFY_WEBHOOK_SECRET` | For orders | Register webhook below |
| `BREVO_API_KEY` | For email journeys | |
| `WATI_API_KEY` | For WhatsApp | |
| `CRON_SECRET` | Yes | Protects `/api/cron/*` |
| `HERMES_API_URL` / `HERMES_API_KEY` | Optional | Agent runtime |

Run migrations and seed admin:

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

Change default admin password immediately after first login.

## 2. Shopify

1. Create Storefront API access token (unauthenticated/read + cart scopes)
2. Set env vars above
3. Register **orders/create** webhook:
   - URL: `https://daakyka.com/api/webhooks/shopify/orders`
   - Format: JSON
   - Copy webhook signing secret → `SHOPIFY_WEBHOOK_SECRET`
4. Place a test order — verify `/admin/orders` and post-purchase journey enrollment

See [SHOPIFY_SETUP.md](./SHOPIFY_SETUP.md) for detail. Deploy staging first: [STAGING_DEPLOY.md](./STAGING_DEPLOY.md).

## 3. Engagement

1. Add Brevo API key + verified sender domain
2. Add WATI API key for WhatsApp templates
3. Approve campaign templates in `/admin/templates`
4. Set `CRON_SECRET` — verify Vercel crons in `vercel.json`:
   - Journeys: daily on Vercel Hobby (`0 9 * * *`); hourly on Pro (`0 * * * *`)
   - Hermes: daily 06:00 UTC
   - Reports: weekly Monday 07:00 UTC
5. Test welcome journey via newsletter signup
6. Test abandoned cart (requires email in cart session)

## 4. SEO

- [ ] Submit sitemap: `https://daakyka.com/sitemap.xml`
- [ ] Verify `robots.txt` allows crawling
- [ ] Google Search Console property verified
- [ ] Rich Results Test on homepage, product, guide page
- [ ] All schema checks green in `/admin/seo`

## 5. QA

Automated QA is **complete** — run `npm run verify:101` and confirm `dogfood-output/COMPLETION.json`.

Complete remaining **manual** items in [QA_CHECKLIST.md](./QA_CHECKLIST.md) on staging URL.

## 6. Monitoring

- [ ] Error tracking (Sentry) connected
- [ ] Uptime monitor on `/api/health` (not cron URLs)
- [ ] Admin audit logs reviewed weekly

## 7. Go-Live

- [ ] DNS pointed to hosting
- [ ] SSL certificate active
- [ ] 301 redirects verified (SEO paths → `/guides/*`)
- [ ] Announcement bar copy finalized
- [ ] Homepage hero CMS updated for launch messaging
- [ ] Team trained on admin panel

## Post-Launch (Week 1)

- Monitor `/admin/orders`, contact enquiries, bulk leads
- Review journey enrollments in `/admin/journeys`
- Check `/admin/reputation` for review gap follow-ups
- Hermes tasks remain **approval-only** — never enable autonomous publish without review
