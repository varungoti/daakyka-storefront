import type { Permission } from "@/lib/auth/rbac";
import type { SettingKey } from "@/lib/settings";

/**
 * F-061 fix: per-key admin permission required to change a given site
 * setting, split out of the single blanket "settings:manage" check that
 * PATCH /api/admin/settings/[key] used to run for every key. MARKETING_ADMIN
 * was documented (rbac.ts, docs/ROLES.md, docs/SITE_CONTROLS.md) as "limited
 * to sale/announcement settings", but nothing enforced that — it could
 * change shipping rates, the public contact phone/WhatsApp/email (which
 * doubles as the internal "New order" alert inbox, see
 * src/lib/orders/notify.ts), and every page toggle.
 *
 * Kept in its own file — not settings/index.ts — because this file is
 * owned by a different release-hardening package in this batch; a separate
 * `Record<SettingKey, Permission>` still gets the same compile-time
 * guarantee (a new SettingKey with no entry here is a type error) without
 * touching that file.
 */
export const settingPermissions: Record<SettingKey, Permission> = {
  // Marketing-facing toggles MARKETING_ADMIN is meant to own.
  "sale.enabled": "settings:marketing",
  "announcement.messages": "settings:marketing",
  "header.bulkCta.enabled": "settings:marketing",
  // Everything else — page visibility, shipping pricing, and the public
  // contact details/order-alert inbox — is store-owner-level.
  "pages.fabricTech.enabled": "settings:manage",
  "pages.mixMatch.enabled": "settings:manage",
  "shipping.flatRate": "settings:manage",
  "shipping.freeAbove": "settings:manage",
  "contact.phone": "settings:manage",
  "contact.whatsapp": "settings:manage",
  "contact.email": "settings:manage",
  "contact.address": "settings:manage",
  // release-hardening pdp-content-legal-pricing-reviews (F-150/F-195/F-026):
  // grievance-officer contact, GST registration and the return-window
  // length are all store-owner-level, same bucket as the rest of "everything
  // else" above — not something MARKETING_ADMIN should be able to change.
  "grievance.name": "settings:manage",
  "grievance.designation": "settings:manage",
  "grievance.email": "settings:manage",
  "grievance.phone": "settings:manage",
  "legal.gstin": "settings:manage",
  "legal.stateCode": "settings:manage",
  "returns.windowDays": "settings:manage",
};
