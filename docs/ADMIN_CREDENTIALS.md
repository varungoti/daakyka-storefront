# Admin Credentials

## How the admin account is created

`prisma/seed.ts` runs on every deploy (and via `npm run db:setup` locally)
and is **create-only**: it bootstraps the SUPER_ADMIN account the first
time it finds none, and never touches an existing user's password, role,
or active status again. A password rotation happens through `/admin/users`
or the admin's own account settings, not by redeploying.

- `ADMIN_SEED_EMAIL` — the admin's login email (defaults to
  `admin@example.com` if unset; not a secret, just an identifier).
- `ADMIN_SEED_PASSWORD` — **required** against any non-local database
  (Vercel staging/production, or a local run pointed at a remote
  `DATABASE_URL`). The seed refuses to run if this is unset or matches a
  known default/weak/leaked password — see `isInsecureSeedPassword()` in
  `src/lib/auth/seed-defaults.ts`. Generate one with `openssl rand -base64 18`.
- `VIEWER_SEED_EMAIL` / `VIEWER_SEED_PASSWORD` — optional; the read-only
  VIEWER account is only created when **both** are set.

Set these in Vercel → Project → Settings → Environment Variables before
the first deploy. Local development reads the same vars from `.env`
(copy `.env.local.example`); if `ADMIN_SEED_PASSWORD` is left unset
locally, `prisma/seed.ts` generates a random one and prints it once to
the terminal — it is never written to a file or committed.

## Local development login

Whatever you put in your own `.env`'s `ADMIN_SEED_EMAIL` /
`ADMIN_SEED_PASSWORD` (or the password printed by `npm run db:seed` if
you left it unset). Login: `/admin/login`.

## Rotating or replacing the admin later

### Option A — New admin, then remove the old one

1. Ask a current SUPER_ADMIN to invite the new admin from `/admin/users`
   (or, until that flow exists, set `ADMIN_SEED_EMAIL` to the new address
   and redeploy — this only *creates* the new user, it won't touch any
   existing one).
2. Log in as the new admin and deactivate the old account under
   `/admin/users`.

### Option B — Rotate your own password

Sign in, then use Account → Change Password in the sidebar (or
`/admin/account`) — it requires your current password and signs out
every other device that was using the old one. A SUPER_ADMIN who has
forgotten their current password can instead use "Reset password" under
`/admin/users`, which issues a new temporary one that must be changed on
next sign-in.

### Option C — Handover to a client

1. Set `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` to the client's own
   values in Vercel and redeploy — this creates their account without
   touching yours.
2. Have the client log in and deactivate every test/handover account
   under `/admin/users`.
3. Rotate `AUTH_SECRET` if it was ever shared outside your team (this
   invalidates all existing sessions).

## Where this is implemented

- `src/lib/auth/seed-defaults.ts` — fallback email and the insecure-password
  deny-list
- `prisma/seed.ts` — `resolveAdminSeedPassword()` and the create-only user
  upserts
- `src/lib/env.ts` — refuses to boot in production without a valid
  `ADMIN_SEED_PASSWORD`, as a second line of defense

Legacy seed users (`admin@daakyka.com`, `viewer@daakyka.com`) are
deactivated automatically, but **only once** per database (the first
deploy that finds them still active), and never if that address is the one
currently configured via `ADMIN_SEED_EMAIL`/`VIEWER_SEED_EMAIL` — so
setting `ADMIN_SEED_EMAIL=admin@daakyka.com` no longer creates the account
and immediately locks it out again. A SUPER_ADMIN who later reactivates one
of these accounts from `/admin/users` stays active across future deploys;
the seed does not touch it a second time.
