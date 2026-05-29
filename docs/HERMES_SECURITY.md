# Hermes Security Guide

## Core Principle

**Hermes never publishes, sends, or mutates production data without human approval.**

## Enforced in Code

1. **Default mode** — `HERMES_DEFAULT_MODE=SUGGEST_ONLY` when unset
2. **Approval queue** — every cron and manual task creates `HermmesApproval` with `PENDING` status
3. **No direct publish APIs** — Hermes client only calls external runtime for suggestions; storefront admin must approve
4. **Campaign gate** — campaigns require `PENDING_APPROVAL` → manual approve before `SENT`
5. **Cron auth** — `/api/cron/*` requires `Authorization: Bearer CRON_SECRET` in production
6. **RBAC** — `hermes:manage` limited to Super Admin, Store Owner, Marketing Admin, SEO Manager
7. **Audit logs** — admin actions logged to `AuditLog`

## What Hermes Cannot Do (by design)

- Send email or WhatsApp directly
- Publish blog posts
- Change homepage CMS content
- Modify Shopify products
- Create admin users
- Read `AUTH_SECRET`, Shopify tokens, or Brevo/WATI keys from task payloads

## Deployment Checklist

- [ ] Keep `HERMES_DEFAULT_MODE=SUGGEST_ONLY` until ops team is trained
- [ ] Restrict `HERMES_API_KEY` to server env only (never `NEXT_PUBLIC_*`)
- [ ] Review Hermes runtime network access — whitelist admin DB read-only if possible
- [ ] Weekly review of pending approvals — do not auto-approve in bulk
- [ ] Disable `AUTONOMOUS_SAFE` unless explicit security sign-off

## Incident Response

If Hermes produces harmful content:
1. Reject approval in `/admin/hermes`
2. Set `HERMES_DEFAULT_MODE=SUGGEST_ONLY`
3. Revoke and rotate `HERMES_API_KEY`
4. Check `AuditLog` and `HermesTask` output for scope

## Testing Safety

Run `npm run test` — includes Hermes safety tests verifying stub mode and default SUGGEST_ONLY.
