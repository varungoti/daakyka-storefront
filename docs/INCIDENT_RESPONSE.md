# Incident & Personal-Data Breach Response

One-page runbook for "something has gone wrong with security or customer data" at DAAKYKA
Apparels. It covers the whole store (Vercel, Supabase, Razorpay, Brevo, WATI, R2). For the narrower
case of harmful Hermes AI output, see [HERMES_SECURITY.md](./HERMES_SECURITY.md); for ordinary
outages and bad deploys, see "Rolling back a bad deploy" in [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md).

> **Status: draft for counsel.** The legal deadlines below are the ones in force or announced at the
> time of writing. Have a lawyer confirm which of them apply to the business (the IT Act's
> "body corporate" definition includes firms and sole proprietorships, so CERT-In almost certainly
> does) and the commencement dates of the DPDP breach provisions, then delete this banner.

## 1. Who does what

| Role | Who | Phone / email |
|---|---|---|
| Incident owner (decides, signs off notifications) | _owner to fill in_ | |
| Backup incident owner | _owner to fill in_ | |
| Technical responder (has Vercel, Supabase and Razorpay access) | _owner to fill in_ | |
| Counsel | _owner to fill in_ | |

An incident is anything that might mean someone who should not have it saw, changed or deleted
customer or admin data, or took control of an account or secret. When unsure, treat it as one and
start the clock in section 5.

## 2. How we find out

- Error reports: structured `"event":"request_error"` log lines and the `ERROR_WEBHOOK_URL` alert
  (see "Monitoring" in the go-live runbook).
- Uptime monitor on `/api/health`.
- Razorpay dashboard alerts (unexpected refunds, chargebacks, failed-signature webhooks).
- Supabase dashboard (unexpected connections, auth anomalies) and `/admin/audit-logs`.
- A customer, researcher or staff member writing to the grievance email or the address in
  `/.well-known/security.txt`.

## 3. First 30 minutes: contain

Do these in order; each one is cheap to reverse and expensive to skip.

1. **Write down the time you noticed it.** The CERT-In 6-hour clock starts then.
2. **Stop the bleeding.**
   - Suspected admin account misuse: `/admin/users` -> deactivate the user, then rotate `AUTH_SECRET`
     (below) to log every session out.
   - Suspected data exfiltration through the app: promote the last known-good deployment
     (`npx vercel rollback <deployment>`; check the target first with
     `node scripts/check-rollback-target.mjs <deployment>`, because a deployment from before
     2026-09-22 points at the old database, see the go-live runbook) while you investigate.
3. **Rotate the secrets that could have been exposed.** Update the value where it lives, then
   redeploy so the new value is picked up (a rollback restores the old deployment's old values, so
   never roll back past a rotation).

   | Secret | Where it lives | Rotate | Side effect |
   |---|---|---|---|
   | `AUTH_SECRET` | Vercel env | New random 32+ chars, redeploy | Logs out every admin and customer |
   | `CRON_SECRET` | Vercel env | New value, redeploy | Vercel crons pick it up on the next deploy |
   | `CREDENTIAL_ENCRYPTION_KEY` | Vercel env | New 32-byte key, redeploy | Saved integration credentials can no longer be decrypted; re-enter them at `/admin/integrations` |
   | Database password | Supabase -> Settings -> Database | Reset password; update `DATABASE_URL` and `MIGRATION_DATABASE_URL` in Vercel; redeploy | Brief errors until the redeploy finishes |
   | Razorpay key id/secret and webhook secret | Razorpay dashboard -> Settings -> API keys / Webhooks | Regenerate; update `/admin/integrations` (or Vercel env) | Webhooks fail until both sides match |
   | `BREVO_API_KEY` | Brevo -> SMTP & API | Create new key, delete old | Email stays queued until updated |
   | `WATI_API_KEY` | WATI dashboard | Regenerate | WhatsApp journeys pause |
   | `OPENAI_API_KEY` | OpenAI dashboard | Revoke and create | AI image generation off until updated |
   | R2 access keys (`R2_*` / `CLOUDFLARE_*`) | Cloudflare -> R2 -> API tokens | Roll the token | Uploads fail until updated; `/cdn` images may 404 |
   | `HERMES_API_KEY` | Vercel env + Hermes service | Rotate both | Hermes tasks fail until both match |
   | Admin passwords | `/admin/users` | Force a reset for every admin | |
   | Vercel / GitHub / Supabase / Cloudflare accounts | Each provider | Change password, revoke other sessions, check 2FA | |

4. **Preserve evidence before it expires.** Export the Vercel runtime logs for the window
   (Vercel keeps them only briefly), the Supabase logs, and the `AuditLog` table
   (`/admin/audit-logs`). Do not delete anything, and do not "clean up" test orders or users until
   the review is finished.

## 4. Assess

Write down, even if the answer is "not known yet":

- What happened, when it started and when it stopped.
- Which systems and which data: customer names, phone numbers, email, delivery addresses, order
  history, admin accounts. (Card and UPI details are entered into Razorpay's checkout and are not
  stored by this app; see [PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md). Confirm that for the
  incident at hand.)
- How many people are affected, and in which states or countries.
- Whether the data was only exposed, or also copied, changed or deleted.

## 5. Notify (who, whom, by when)

| Who is told | When | How | Applies |
|---|---|---|---|
| **CERT-In** | Within **6 hours** of noticing a reportable cyber incident (data breach, data leak, unauthorised access to systems or data, compromise of applications or accounts, and the other categories in the 28 April 2022 directions) | Email `incident@cert-in.org.in` with the incident form from cert-in.org.in; toll-free 1800-11-4949 (confirm the current contacts on cert-in.org.in) | In force since June 2022 |
| **Data Protection Board of India** and **each affected person** | Without delay; then a detailed report to the Board within **72 hours** | Per the DPDP Act s.8(6) and the DPDP Rules | Once the breach-intimation provisions commence (announced as phased in over roughly 18 months from the November 2025 notification, so around May 2027). Counsel to confirm. Until then, notifying affected customers promptly is still the right thing to do. |
| **Razorpay** | Immediately if payment data or keys are involved | Razorpay support / dashboard | Always |
| **Hosting and service providers** (Vercel, Supabase) | As soon as their help is needed | Support ticket | Always |
| **Police / cyber-crime portal** | On counsel's advice, or if extortion or fraud is involved | cybercrime.gov.in | As advised |

The incident owner decides and signs off every notification. Keep a copy of what was sent and when.

### CERT-In report: what to include

Time noticed; type of incident; affected systems (Vercel project `storefront`, Supabase project,
R2 bucket); what is known so far about the cause and the data; containment steps taken; contact
person. Send what you have inside the 6 hours and follow up; do not wait for a complete picture.

### Message to affected customers (adapt before sending)

> Subject: Important: a security incident affecting your DAAKYKA account
>
> On [date] we found that [what happened, in plain words]. It involved [which of your details:
> name, phone, email, address, order history] and did not involve [your card or UPI details,
> which we never store, if true]. We have [what we did to stop it]. You should [what they should
> do: be careful with calls or messages claiming to be about an order; change the password they
> reuse elsewhere]. Questions: [grievance email and phone]. We are sorry this happened.

### Message to the Data Protection Board (once required)

Nature, extent, timing and likely impact of the breach; the measures taken and planned; findings
about who caused it, if known; who was told and when; a contact for the Board. The 72-hour
detailed report adds the full chronology and the remediation plan.

## 6. Recover and learn

1. Confirm the cause is closed (patched, secret rotated, account removed) and watch the logs for a
   week for repeat activity.
2. Restore anything damaged from backup (see "Backups & restore" in the go-live runbook).
3. Write a short post-mortem within a week: timeline, root cause, what worked, what changes.
4. Update this runbook and the privacy policy if the process changed.
5. Run a 30-minute tabletop of this page once a year, and after any change of who holds which
   account.

## 7. Log retention policy (CERT-In: 180 days)

The CERT-In directions require ICT-system logs to be kept for **180 days**, within India, and
produced on request. Policy for this store:

| Log | Where it is today | Retention required | Status |
|---|---|---|---|
| Application / request logs, including the structured `request_error` lines | Vercel runtime logs (a few hours to about 30 days depending on plan) | 180 days | **Not yet met.** Needs a Vercel Log Drain (Pro plan) to storage with a 180-day (or longer) retention rule, in an India-hosted region or confirmed by counsel as acceptable. Owner action. |
| Admin audit trail (`AuditLog` table, `/admin/audit-logs`) | Production Postgres | 180 days | Met by design: nothing in the app prunes it. Do not add pruning that deletes rows younger than 180 days. |
| Database logs | Supabase dashboard (short retention) | 180 days | **Not yet met.** Export or drain if the plan allows, or accept the app-level audit trail plus the drain above as the system of record (counsel to confirm). |
| Payment logs | Razorpay dashboard | Per Razorpay | Held by Razorpay |
| Email delivery logs | Brevo | Per Brevo | Held by Brevo |

Rules for whatever collects the logs:

- Never drain request bodies, cookies, `Authorization` headers or card/OTP data. The app's own error
  reporter already omits headers, query strings and bodies.
- Keep logs read-only for everyone except the incident owner and technical responder.
- Record where the drain and its storage live (account, region, retention rule, who can read it) in
  the table above as soon as it exists; it is configured in dashboards, not in this repo.

## 8. Public security contact

`/.well-known/security.txt` (the file is `public/.well-known/security.txt`) tells researchers where
to report a vulnerability. Its `Contact:` line must be a mailbox somebody reads every day. If the
business email changes, edit the file in the same change. RFC 9116 asks for an `Expires:` date
under a year ahead and an expired file is itself flagged by scanners, so renew it every year: put
the renewal on the owner's calendar. Add a `Canonical:` line with the real production URL once the
custom domain is live.

The privacy policy's breach-notification sentence is part of the legal pages and is edited from
the legal-page code, not from this document.
