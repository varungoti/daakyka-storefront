# Admin Panel Guide

Login: `/admin/login` — the account is created by the seed from `ADMIN_SEED_EMAIL` /
`ADMIN_SEED_PASSWORD`, not from a fixed default in `.env.local.example` — see
[ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md) for how it's created and how to rotate or hand it
over. Every workflow below works from a phone: the admin panel is responsive, and this is written
assuming that's how you'll usually be using it.

## Roles

Generated from `rolePermissions` in `src/lib/auth/rbac.ts` — that file is the source of truth if
this ever drifts.

| Role | Typical use |
|---|---|
| Super Admin | Full access, including user management and integrations |
| Store Owner | Everything Super Admin has except user management |
| Marketing Admin | Homepage, blog, engagement, journeys, Hermes, SEO, offers, testimonials |
| Catalog Manager | Products, categories, media — can't publish a product live |
| Order Manager | Orders, customers (view), bulk-order leads |
| SEO Manager | SEO audit, blog, homepage copy, Hermes |
| Content Editor | Blog, testimonials, homepage, media |
| Bulk Order Manager | Bulk leads and contact enquiries only |
| Support Agent | Orders (view), customers (view), review moderation, bulk leads |
| Viewer | Read-only dashboard, intelligence, audit logs |

## Key Workflows

### Orders
`/admin/orders` — list, filter, and open an order to change its status (e.g. `PROCESSING` →
`SHIPPED` → `DELIVERED`), add a courier tracking number, or cancel/refund. Status changes append to
the order's timeline (also shown to the customer at `/order/[number]` and `/account/orders`) and
can fire a notification email. Orders placed with no Razorpay keys configured land here as
`PROCESSING` "order request" orders for manual follow-up (no online payment taken).

### Products & Variants
`/admin/products` — add, edit, publish, and bulk-import the catalog, including size × colour
variant generation and stock. New products can have images staged and attached before the very
first save. Full walkthrough: [ADMIN_CATALOG_GUIDE.md](./ADMIN_CATALOG_GUIDE.md).

### Categories
`/admin/categories` — the category tree products are filed under (drives shop-page filters and
navigation). Each category can carry its own default size chart.

### Customers
`/admin/customers` — registered customer accounts and their order history. Read-only beyond basic
lookup; a customer's own password/profile changes happen on their side (`/account`).

### Discounts
`/admin/discounts` — percentage/flat discount codes, with optional usage limits and expiry, applied
at checkout.

### Homepage
`/admin/homepage` — edit hero slides, headline/subcopy/CTA, trust stats, and the announcement bar
without a code change or redeploy (saves call `revalidateTag`, so an edit shows up within one
reload — see the caching note in `LAUNCH_CHECKLIST.md` §7).

### Site Controls
`/admin/site-controls` — the sale banner and header "bulk order" CTA toggle (Marketing Admin and
above), plus shipping rates, the public contact phone/WhatsApp/email/address shown on the storefront,
and page-visibility toggles (Store Owner/Super Admin only).

### Media Library
`/admin/media` — every uploaded/generated image in one place; used to pick an existing image
instead of re-uploading (e.g. for a homepage hero slide) as well as to upload founder portraits and
client logos, which are never AI-generated.

### Blog CMS
`/admin/blog` — create drafts, publish to `/blog/[slug]`. Published posts appear in the sitemap.

### Bulk Orders
`/admin/bulk-orders` — hospital and institutional leads from `/bulk-orders`. Update status as you
progress quotes.

### Contact Enquiries
`/admin/contact-enquiries` — general and institutional messages from `/contact`.

### Engagement
`/admin/engagement` — campaign overview. `/admin/templates` — email/WhatsApp templates.
`/admin/segments` — audience segments. `/admin/campaigns` — campaigns require **approval** before
send.

### Customer Journeys
`/admin/journeys` — welcome, bulk, abandoned cart, post-purchase sequences. Enrollments are
processed every 15 minutes by `/api/cron/journeys` once `CRON_SECRET` is set — see
[ENGAGEMENT_AUTOMATIONS.md](./ENGAGEMENT_AUTOMATIONS.md) for the full cron schedule.

### SEO
`/admin/seo` — metadata audit + JSON-LD schema validation. Guide pages live at `/guides/*` (data in
`src/data/seo-landing-pages.ts`).

### Intelligence & Reputation
`/admin/intelligence` — product insights and view analytics. `/admin/reviews` — moderate submitted
product reviews. `/admin/reputation` — testimonials and review-gap follow-ups (products with sales
but no reviews yet).

### Weekly Reports
`/admin/reports` — 7-day growth snapshot. Automated every Monday via `/api/cron/reports`.

### Hermes
`/admin/hermes` — AI task queue. All outputs go to the **approval queue** — never auto-publish or
auto-send.

### Integrations
`/admin/integrations` — enter and test Razorpay (Key ID, Key Secret, Webhook Secret), Brevo (API
key, from-email), and toggle WATI/Hermes connection status. Values entered here are encrypted at
rest and always take priority over the equivalent env var, with no redeploy needed — see
[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) §3.

### Users & Audit
`/admin/users` — RBAC user management, including inviting a new admin (Super Admin only — see
[ADMIN_CREDENTIALS.md](./ADMIN_CREDENTIALS.md)). `/admin/audit-logs` — admin action history.
`/admin/account` — change your own password.

## Safety Rules

- Hermes default mode: `SUGGEST_ONLY`
- Campaigns cannot send without approval
- Cron endpoints require `CRON_SECRET` in production
- Never share `AUTH_SECRET` or API keys in chat or commits
