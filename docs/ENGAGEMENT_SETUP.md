# Engagement Setup Guide

Email (Brevo) and WhatsApp (WATI) power customer journeys and campaigns.

## Environment

```env
BREVO_API_KEY=your-brevo-api-key
BREVO_FROM_EMAIL=noreply@daakyka.com
BREVO_FROM_NAME=DAAKYKA Apparels

WATI_API_KEY=your-wati-token
WATI_API_URL=https://live-server.wati.io
```

## Brevo (Email)

1. Create account at [brevo.com](https://www.brevo.com)
2. Verify sender domain (`daakyka.com`) — SPF/DKIM records
3. Generate API key → `BREVO_API_KEY`
4. Set `BREVO_FROM_EMAIL` to a verified sender

## WATI (WhatsApp)

1. Connect WhatsApp Business via WATI
2. Create approved message templates for journey steps
3. Copy API token → `WATI_API_KEY`

## Admin Setup

1. **Templates** — `/admin/templates` — create EMAIL and WHATSAPP templates with variables (`{{name}}`, etc.)
2. **Segments** — `/admin/segments` — define audiences (newsletter, bulk leads, etc.)
3. **Journeys** — `/admin/journeys` — seeded journeys: Welcome, Bulk, Abandoned Cart, Post-Purchase
4. **Campaigns** — `/admin/campaigns` — one-off sends; status flow: DRAFT → PENDING_APPROVAL → APPROVED → SENT

## Journey Triggers

| Trigger | Source |
|---|---|
| `newsletter_signup` | Footer newsletter form |
| `bulk_order_submitted` | `/api/bulk-orders` |
| `institutional_contact` | Contact form (institutional type) |
| `cart_abandoned` | `/api/cart/abandon` (requires email) |
| `order_created` | Shopify webhook `/api/webhooks/shopify/orders` |

## Cron (Required in Production)

```env
CRON_SECRET=long-random-secret
```

- **Hourly** — `/api/cron/journeys` processes due journey steps
- Verify in Vercel → Cron Jobs (see `vercel.json`)

## Testing Without Live Send

Without API keys, journey steps are logged as `JourneyEvent` records and appear in `/admin/notifications`. No external email/WhatsApp is sent until providers are configured.

## Approval Workflow

All campaigns and Hermes-generated promos require human approval. Marketing Admin or Store Owner approves in `/admin/campaigns` or `/admin/hermes`.
