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

## Cron schedule (Vercel)

| Path | Schedule | Action |
|------|----------|--------|
| `/api/cron/journeys` | `0 9 * * *` daily | Process due journey enrollments |
| `/api/cron/hermes` | `0 6 * * *` daily | SEO/competitor scans → approval queue |
| `/api/cron/reports` | `0 7 * * 1` weekly | Weekly growth report + Hermes task |
| `/api/cron/campaigns` | `0 10 * * *` daily | Send `SCHEDULED` campaigns where `scheduledAt <= now` |

All crons require `Authorization: Bearer $CRON_SECRET`.

## Campaign workflow

1. Create campaign in **Admin → Campaign Planner** with segment + template.
2. Move status to `PENDING_APPROVAL` → `APPROVED`.
3. **Send now:** PATCH status `APPROVED` with `{ "sendNow": true }` or PATCH status `SENT`.
4. **Schedule:** PATCH status `SCHEDULED` with `{ "scheduledAt": "2026-06-01T10:00:00.000Z" }` — campaigns cron dispatches automatically.

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
- [ ] Shopify webhooks for order-triggered journeys
