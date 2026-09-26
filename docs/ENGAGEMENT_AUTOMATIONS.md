# Engagement & Marketing Automations

Production-ready outreach stack for DAAKYKA storefront.

## Components

| Layer | Path | Role |
|-------|------|------|
| Journey engine | `src/lib/engagement/journey-engine.ts` | Multi-step flows (newsletter, bulk lead, cart abandon, post-purchase) |
| Campaign dispatcher | `src/lib/engagement/campaign-dispatcher.ts` | Segment → Brevo/WATI broadcast |
| Segment resolver | `src/lib/engagement/segment-resolver.ts` | Maps segment criteria to recipients |
| Hermes executor | `src/lib/hermes/approval-executor.ts` | Applies approved blog/campaign drafts |
| Integration gates | `src/lib/integrations/enabled.ts` | Env + admin toggle before send |

## Cron schedule (Vercel, `vercel.json`)

All times are UTC, with the IST (UTC+5:30) equivalent alongside — the Vercel scheduler itself runs
in UTC, and IST is the timezone the DAAKYKA (Hyderabad) team works in. `scheduledAt` values and
journey step delays are rounded up to the next time one of these crons actually runs — a
`*/15 * * * *` job can be up to ~15 minutes late, `0 6 * * *` up to ~24 hours late if the due time
just passed.

| Path | Schedule (UTC) | IST | Action |
|------|-----------------|-----|--------|
| `/api/cron/journeys` | `*/15 * * * *` | every 15 min | Process due journey enrollments (cart reminder, post-purchase, etc.) |
| `/api/cron/campaigns` | `*/15 * * * *` | every 15 min | Send `SCHEDULED` campaigns where `scheduledAt <= now` |
| `/api/cron/cancel-stale-orders` | `*/15 * * * *` | every 15 min | Cancel Razorpay orders that never completed payment |
| `/api/cron/drain-email-outbox` | `*/15 * * * *` | every 15 min | Retry queued transactional emails (order/verify/reset) |
| `/api/cron/back-in-stock` | `*/15 * * * *` | every 15 min | Notify shoppers subscribed to a now-restocked variant |
| `/api/cron/hermes` | `0 6 * * *` daily | 11:30 AM | SEO/competitor scans → approval queue |
| `/api/cron/reports` | `0 7 * * 1` weekly (Monday) | Monday 12:30 PM | Weekly growth report + Hermes task |

All crons require `Authorization: Bearer $CRON_SECRET`. Journeys and campaigns run every 15 minutes
on every plan this project has used (Vercel's Hobby tier caps crons at once/day — this project's
`*/15` schedules already require at least Pro).

## Campaign workflow

1. Create campaign in **Admin → Campaign Planner** with segment + template.
2. Move status to `PENDING_APPROVAL` → `APPROVED`.
3. **Send now:** PATCH status `APPROVED` with `{ "sendNow": true }` or PATCH status `SENT`.
4. **Schedule:** PATCH status `SCHEDULED` with `{ "scheduledAt": "2026-06-01T10:00:00.000Z" }` — the
   `/api/cron/campaigns` job (every 15 minutes, see above) picks it up on its next run once
   `scheduledAt` has passed; it isn't dispatched the instant `scheduledAt` arrives.

Dispatch creates an admin notification with sent/stub/failed counts.

## Integration toggles

1. Set provider env vars (`BREVO_API_KEY`, `WATI_API_KEY`, etc.).
2. **Admin → Integrations** — enable the provider (stored in `IntegrationSetting`).
3. Sends are blocked unless **both** env is configured **and** admin toggle is enabled.

## WATI templates

For cold WhatsApp outreach outside the 24h session window:

```env
WATI_USE_TEMPLATES=true
WATI_BROADCAST_TEMPLATE=your_approved_template_name
WATI_BROADCAST_NAME=DAAKYKA Campaign
```

Without a template, WATI falls back to session messages (works for opted-in recent chats).

## Hermes approvals

When an approval is **Approved** in Admin → Hermes:

- `blog_draft` → creates `BlogPostRecord` (DRAFT)
- `campaign_draft` → creates `Campaign` (PENDING_APPROVAL)
- `daily_seo_health_scan` / `weekly_competitor_scan` → admin notification

External Hermes runtime: set `HERMES_API_URL` + enable in Integrations.

## Credentials checklist (go-live)

- [ ] `BREVO_API_KEY` + enable Brevo in admin
- [ ] `WATI_API_KEY` + approved templates + enable WATI
- [ ] `CRON_SECRET` on Vercel
- [ ] `HERMES_API_URL` (optional) + enable Hermes

Order-triggered (`order_created`) journeys fire natively from every checkout path
(`src/lib/orders/notify.ts`) — no Shopify webhook is needed for this.
