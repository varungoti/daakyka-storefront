# Hermes Agent Setup Guide

Hermes is the autonomous marketing intelligence layer — it **suggests and drafts**, never publishes without approval.

## Environment

```env
HERMES_API_URL=https://your-hermes-runtime.example.com
HERMES_API_KEY=your-api-key
HERMES_DEFAULT_MODE=SUGGEST_ONLY
```

## Modes

| Mode | Behavior |
|---|---|
| `SUGGEST_ONLY` | **Default.** Recommendations only — no drafts sent externally |
| `DRAFT_MODE` | Creates drafts in admin for review |
| `ASSISTED_PUBLISH` | Requires explicit approval per action |
| `AUTONOMOUS_SAFE` | Never enable in production without security review |

## Local / Staging Without Runtime

When `HERMES_API_URL` is unset, tasks return **stub output** and still create records in:
- `/admin/hermes` — task list
- Hermes approval queue — pending review

## Scheduled Tasks

Daily cron (`/api/cron/hermes`, 06:00 UTC):
- `daily_seo_health_scan`
- `weekly_competitor_scan`

Weekly cron (`/api/cron/reports`, Monday 07:00 UTC):
- `weekly_growth_report` — metrics + recommendations

Manual launch: POST `/api/admin/hermes/tasks` from admin UI.

## NousResearch Runtime (Production)

1. Deploy Hermes adapter per your NousResearch / agent infrastructure
2. Expose `POST /tasks` endpoint accepting `{ type, mode, input }`
3. Return `{ taskId, output }` JSON
4. Set `HERMES_API_URL` and `HERMES_API_KEY`

Task types used by storefront:
- `seo_scan`, `daily_seo_health_scan`, `weekly_competitor_scan`
- `weekly_growth_report`
- Custom tasks from admin manual launcher

## Admin Workflow

1. Task runs (cron or manual)
2. Output saved to `HermesTask`
3. `HermesApproval` created with status `PENDING`
4. Admin reviews in `/admin/hermes`
5. Approve or reject — **no auto-publish path exists in codebase**

See [HERMES_SECURITY.md](./HERMES_SECURITY.md) for guardrails.
