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
Seed: `varungoti@gmail.com` / `Daakyka@2026` — see [ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md) to swap client credentials later.

## Documentation Index

| Doc | Purpose |
|---|---|
| [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) | **What's done vs blocked** |
| [README.md](../README.md) | Stack, scripts, phase status |
| [COMPLETION_STATUS.md](./COMPLETION_STATUS.md) | 101% completion map |
| [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md) | Staging → production steps |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Go-live steps |
| [QA_CHECKLIST.md](./QA_CHECKLIST.md) | Pre-launch QA |
| [SHOPIFY_SETUP.md](./SHOPIFY_SETUP.md) | Storefront API + webhooks |
| [ENGAGEMENT_SETUP.md](./ENGAGEMENT_SETUP.md) | Brevo + WATI + journeys |
| [HERMES_SETUP.md](./HERMES_SETUP.md) | Agent runtime |
| [HERMES_SECURITY.md](./HERMES_SECURITY.md) | Safety guardrails |
| [ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md) | Test admin email + client handover |
| [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) | Admin panel workflows |
| [SEO_GUIDE.md](./SEO_GUIDE.md) | SEO architecture |
| [HARDENING.md](./HARDENING.md) | Security & production controls |

## Credentials Required for Production

- `DATABASE_URL` (Postgres — Neon project `misty-band-54920643` on staging)
- `AUTH_SECRET`, `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- Shopify Storefront token + webhook secret
- `BREVO_API_KEY`, `WATI_API_KEY`

## Automated Verification

```bash
npm run verify:101              # Local: 195 tests + Lighthouse
npm run verify:staging:full     # Live staging probe + 122 remote tests
npm run go-live:check           # Env checklist before promote
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
| Production hardening + 195 automated tests | ✅ |
| Staging deploy verified | ✅ https://storefront-nu-woad.vercel.app |
| Shopify live checkout | ⏳ Needs credentials |
| Live email/WhatsApp | ⏳ Needs Brevo/WATI |
| Production DNS | ⏳ `daakyka.com` |

**Full status:** [LAUNCH_STATUS.md](./LAUNCH_STATUS.md)

## Support Contacts

- Brand site: [daakyka.com](https://daakyka.com)
- Master plan: `/Proposal/DAAKYKA_AUTONOMOUS_STORE_MASTER_PLAN.md`

## Post-Handover Maintenance

- Weekly: review `/admin/reports`, approve Hermes queue, follow bulk leads
- Monthly: SEO audit in admin, refresh blog, check integration status
- Rotate admin password and API keys quarterly
