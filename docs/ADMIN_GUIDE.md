# Admin Panel Guide

Login: `/admin/login` — default seed credentials in `.env.local.example` (change immediately in production).

## Roles

| Role | Typical use |
|---|---|
| Super Admin | Full access, user management, integrations |
| Store Owner | Storefront, marketing, approvals |
| Marketing Admin | Campaigns, journeys, Hermes, testimonials |
| SEO Manager | SEO manager, blog, homepage copy |
| Content Editor | Blog and testimonials only |
| Bulk Order Manager | Bulk leads and contact enquiries |
| Viewer | Read-only dashboard, intelligence, audit logs |

## Key Workflows

### Homepage
`/admin/homepage` — edit hero headline, subcopy, and CTA without code changes.

### Blog CMS
`/admin/blog` — create drafts, publish to `/blog/[slug]`. Published posts appear in sitemap.

### Bulk Orders
`/admin/bulk-orders` — hospital and institutional leads from `/bulk-orders`. Update status as you progress quotes.

### Contact Enquiries
`/admin/contact-enquiries` — general and institutional messages from `/contact`.

### Engagement
`/admin/engagement` — campaign overview. `/admin/templates` — email/WhatsApp templates. `/admin/segments` — audience segments. `/admin/campaigns` — campaigns require **approval** before send.

### Customer Journeys
`/admin/journeys` — welcome, bulk, abandoned cart, post-purchase sequences. Enrollments processed via cron when `CRON_SECRET` is set (daily on Vercel Hobby; hourly on Pro).

### SEO
`/admin/seo` — metadata audit + JSON-LD schema validation. Guide pages live at `/guides/*` (data in `src/data/seo-landing-pages.ts`).

### Intelligence & Reputation
`/admin/intelligence` — product insights and view analytics. `/admin/reputation` — testimonials and review gaps.

### Weekly Reports
`/admin/reports` — 7-day growth snapshot. Automated every Monday via `/api/cron/reports`.

### Hermes
`/admin/hermes` — AI task queue. All outputs go to **approval queue** — never auto-publish or auto-send.

### Integrations
`/admin/integrations` — Shopify, Brevo, WATI, Hermes connection status.

### Users & Audit
`/admin/users` — RBAC user management (Super Admin). `/admin/audit-logs` — admin action history.

## Safety Rules

- Hermes default mode: `SUGGEST_ONLY`
- Campaigns cannot send without approval
- Cron endpoints require `CRON_SECRET` in production
- Never share `AUTH_SECRET` or API keys in chat or commits
