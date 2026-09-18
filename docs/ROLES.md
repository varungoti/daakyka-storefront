# Admin Roles &amp; Permissions (RBAC)

Source of truth: `src/lib/auth/rbac.ts` — every role's permission list lives in the
`rolePermissions` map in that one file. This doc is generated from reading it directly; if the two
ever disagree, the code wins and this doc is stale.

Enforcement: every admin API route calls `requireAdminPermission(permission)`
(`src/lib/auth/admin-api.ts`), which reads the session (`getSession()`), 401s if there's no
session, and 403s if `hasPermission(session.role, permission)` is false. Admin **pages** get a
coarser check inline (`hasPermission(session.role, ...)` then `redirect("/admin/dashboard")`) —
see any file under `src/app/admin/(panel)/**/page.tsx`. `middleware.ts` separately guards
`/admin/*` and `/api/admin/*` at the session-cookie level (missing/invalid session → redirect or
401) before any of this runs.

## Roles

`adminRoles` (`src/lib/auth/rbac.ts`): `SUPER_ADMIN`, `STORE_OWNER`, `MARKETING_ADMIN`,
`CATALOG_MANAGER`, `ORDER_MANAGER`, `SEO_MANAGER`, `CONTENT_EDITOR`, `BULK_ORDER_MANAGER`,
`SUPPORT_AGENT`, `VIEWER`.

- **SUPER_ADMIN** — every permission, including `users:manage` (create/edit other admins). The
  only role that can manage the admin user list.
- **STORE_OWNER** — every permission *except* `users:manage`. Intended for the business owner who
  needs full operational control of the storefront but shouldn't be creating admin accounts.
- **MARKETING_ADMIN** — homepage, blog, engagement/journeys, Hermes, SEO, offers, market
  intelligence, testimonials, and audit log. Also has `settings:manage`, but that's meant for the
  sale/announcement toggles on `/admin/site-controls`, not full operational control of the site
  (see [SITE_CONTROLS.md](./SITE_CONTROLS.md)).
- **CATALOG_MANAGER** — can view, create, and edit products and categories, manage media, and
  generate AI images, but deliberately **cannot** publish (`products:publish` is withheld) — a
  catalog manager stages changes for someone with publish rights to ship.
- **ORDER_MANAGER** — order queue (view + manage status/fulfillment), customer list (view only),
  and bulk-order leads.
- **SEO_MANAGER** — SEO/metadata tooling, homepage and blog copy, market intelligence, Hermes, and
  read-only product visibility (to check what's live) — no catalog write access.
- **CONTENT_EDITOR** — blog, testimonials, homepage copy, and media uploads. No product, order, or
  settings access.
- **BULK_ORDER_MANAGER** — narrowly scoped to hospital/institutional bulk-order leads plus the
  dashboard.
- **SUPPORT_AGENT** — order and customer visibility, review moderation, and bulk-order leads, for
  handling customer-facing questions without catalog or settings access.
- **VIEWER** — read-only: dashboard, market intelligence, and audit logs. No manage permissions at
  all.

## Permission matrix

Columns: **SA** = SUPER_ADMIN, **SO** = STORE_OWNER, **MA** = MARKETING_ADMIN,
**CM** = CATALOG_MANAGER, **OM** = ORDER_MANAGER, **SM** = SEO_MANAGER,
**CE** = CONTENT_EDITOR, **BOM** = BULK_ORDER_MANAGER, **SUP** = SUPPORT_AGENT, **V** = VIEWER.

| Permission | SA | SO | MA | CM | OM | SM | CE | BOM | SUP | V |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `dashboard:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `homepage:manage` | ✓ | ✓ | ✓ | | | ✓ | ✓ | | | |
| `blog:manage` | ✓ | ✓ | ✓ | | | ✓ | ✓ | | | |
| `bulk-orders:manage` | ✓ | ✓ | | | ✓ | | | ✓ | ✓ | |
| `engagement:manage` | ✓ | ✓ | ✓ | | | | | | | |
| `journeys:manage` | ✓ | ✓ | ✓ | | | | | | | |
| `intelligence:view` | ✓ | ✓ | ✓ | | | ✓ | | | | ✓ |
| `integrations:manage` | ✓ | ✓ | | | | | | | | |
| `hermes:manage` | ✓ | ✓ | ✓ | | | ✓ | | | | |
| `seo:manage` | ✓ | ✓ | ✓ | | | ✓ | | | | |
| `offers:manage` | ✓ | ✓ | ✓ | | | | | | | |
| `market:view` | ✓ | ✓ | ✓ | | | ✓ | | | | |
| `testimonials:manage` | ✓ | ✓ | ✓ | | | | ✓ | | | |
| `users:manage` | ✓ | | | | | | | | | |
| `audit:view` | ✓ | ✓ | ✓ | | | ✓ | | | | ✓ |
| `settings:manage` | ✓ | ✓ | ✓ | | | | | | | |
| `products:view` | ✓ | ✓ | | ✓ | | ✓ | | | | |
| `products:manage` | ✓ | ✓ | | ✓ | | | | | | |
| `products:publish` | ✓ | ✓ | | | | | | | | |
| `categories:manage` | ✓ | ✓ | | ✓ | | | | | | |
| `media:manage` | ✓ | ✓ | | ✓ | | | ✓ | | | |
| `ai:generate` | ✓ | ✓ | | ✓ | | | | | | |
| `reviews:moderate` | ✓ | ✓ | | | | | | | ✓ | |
| `orders:view` | ✓ | ✓ | | | ✓ | | | | ✓ | |
| `orders:manage` | ✓ | ✓ | | | ✓ | | | | | |
| `customers:view` | ✓ | ✓ | | | ✓ | | | | ✓ | |
| `customers:manage` | ✓ | ✓ | | | | | | | | |
| `shopify:sync` | ✓ | ✓ | | | | | | | | |

Note the `products:manage` / `products:publish` split: `CATALOG_MANAGER` has the former but not
the latter, so it can create and edit products (including saving as a draft, editing variants and
images) but the **Publish** button stays disabled for that role — see
[ADMIN_CATALOG_GUIDE.md](./ADMIN_CATALOG_GUIDE.md).

## Changing a user's role

`/admin/users` (requires `users:manage`, i.e. SUPER_ADMIN only). The admin's role is not baked
into the session cookie — `verifySessionToken()` (`src/lib/auth/session.ts`) looks up the user's
current `role` from the database on every request. On top of that, changing a role (or
deactivating a user) bumps that user's `sessionVersion`
(`src/app/api/admin/users/[id]/route.ts`), which invalidates every JWT minted before the bump
immediately — the affected admin is signed out everywhere and must log in again rather than
merely picking up the new role on their next click.
