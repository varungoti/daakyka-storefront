import type { AdminRole } from "@/generated/prisma/client";
import { hasPermission, type Permission } from "@/lib/auth/rbac";

/**
 * F-268: `/admin/notifications` used to gate its *entire* page — the
 * generic admin-notification feed, the transactional Email Outbox (every
 * customer's order/verify/reset emails), and the Journey Event Log — on a
 * single permission, `bulk-orders:manage`. That got the RBAC backwards:
 *
 * - MARKETING_ADMIN has `journeys:manage`/`engagement:manage` but not
 *   `bulk-orders:manage`, so it was redirected away and could never see
 *   the Journey Event Log or a campaign's sent/failed result — data it
 *   actually needs.
 * - BULK_ORDER_MANAGER has `bulk-orders:manage` but neither `orders:view`
 *   nor `customers:view` — every other order/customer page correctly
 *   redirects it — yet this page let it read the Email Outbox, including
 *   every customer's order-confirmation and password-reset emails.
 *
 * There's no dedicated `notifications:view`/`journeys:view` permission in
 * src/lib/auth/rbac.ts (that file isn't ours to add one to in this
 * package), so this composes the existing permissions that already
 * govern the *kind* of data each section shows, mirroring what
 * `/admin/orders`, `/admin/customers`, `/admin/journeys` and
 * `/admin/engagement` themselves check. Kept as plain, pure predicates
 * (not inline in the page) so the role matrix is unit-testable without a
 * DB or a rendered page.
 */

/**
 * The permission set that decides page/nav access — one array shared by
 * the page itself, the sidebar nav item and the mark-read API routes, so
 * they can't drift out of sync the way the old single-permission gate
 * and the sidebar's separate hardcoded badge check did.
 */
export const NOTIFICATIONS_PAGE_PERMISSIONS: Permission[] = [
  "bulk-orders:manage",
  "orders:view",
  "customers:view",
  "engagement:manage",
  "journeys:manage",
];

/** Whether `role` may open `/admin/notifications` at all (sees at least one section). */
export function canViewNotificationsPage(role: AdminRole): boolean {
  return NOTIFICATIONS_PAGE_PERMISSIONS.some((permission) => hasPermission(role, permission));
}

/** Order/customer PII: order confirmations, verify-account and password-reset emails. */
export function canViewEmailOutbox(role: AdminRole): boolean {
  return hasPermission(role, "orders:view") || hasPermission(role, "customers:view");
}

/** Journey enrollment / trigger activity — a marketing concern, not a bulk-order one. */
export function canViewJourneyLog(role: AdminRole): boolean {
  return hasPermission(role, "engagement:manage") || hasPermission(role, "journeys:manage");
}

/**
 * `AdminNotification.type` values written for a new order (see
 * src/lib/orders/notify.ts and the Shopify webhook) — these carry the
 * same customer email + order amount the Email Outbox does, so they're
 * gated the same way the outbox is, independent of the generic
 * `bulk-orders:manage` list.
 */
export const ORDER_NOTIFICATION_TYPES: readonly string[] = [
  "order_paid",
  "order_request",
  "order_created",
];
