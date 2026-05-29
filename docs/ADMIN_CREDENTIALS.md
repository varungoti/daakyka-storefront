# Admin Credentials

## Current test setup

| Account | Email | Default password | Role |
|---------|-------|------------------|------|
| **Primary admin** | `varungoti@gmail.com` | `Daakyka@2026` | SUPER_ADMIN |
| RBAC test viewer | `varungoti+viewer@gmail.com` | `Daakyka@Viewer2026` | VIEWER |

The viewer address is a Gmail **+alias** — mail goes to the same inbox as `varungoti@gmail.com`, but it is a separate login in the admin panel for automated RBAC tests.

Login: `/admin/login` on staging or local.

---

## Swapping to client credentials later

You can switch from your test email to the client’s admin without code changes.

### Option A — Environment variables (recommended before go-live)

1. Set in Vercel (or local `.env`):
   - `ADMIN_SEED_EMAIL=client@example.com`
   - `ADMIN_SEED_PASSWORD=<strong-password>`
2. Redeploy (build runs `tsx prisma/seed.ts`, which upserts the super admin).
3. Log in as the client email and deactivate old test users under `/admin/users`.

### Option B — Admin panel only

1. Log in as super admin.
2. Go to `/admin/users` — change roles or deactivate test accounts.
3. Use **Account settings** / password change flow if exposed, or create a new SUPER_ADMIN for the client and deactivate yours.

### Option C — Production handover

1. Client creates their password via seed env on first deploy to production.
2. Remove or disable `varungoti@gmail.com` and `varungoti+viewer@gmail.com` in `/admin/users`.
3. Rotate `AUTH_SECRET` if test/staging secrets were shared.

---

## Where defaults are defined

- `src/lib/auth/seed-defaults.ts` — fallback emails/passwords
- `prisma/seed.ts` — creates users on `npm run db:setup` and every Vercel build
- Override anytime with `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, `VIEWER_SEED_EMAIL`, `VIEWER_SEED_PASSWORD`

Legacy seed users (`admin@daakyka.com`, `viewer@daakyka.com`) are **deactivated** automatically on re-seed.
