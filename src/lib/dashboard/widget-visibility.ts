import type { AdminRole } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * F-161: the dashboard used to run every query and render every widget
 * for every role, with no RBAC check at all — a CONTENT_EDITOR or VIEWER
 * could see bulk-lead contacts, today's revenue and the full audit
 * trail, and the "View all" / "Orders Today" links they saw pointed at
 * pages that silently `redirect()` back to the dashboard for that role.
 *
 * Each flag here mirrors the permission the *target* page itself checks
 * (e.g. `orders` mirrors `/admin/orders`'s `orders:view` gate), so a
 * widget is only shown to a role for which following it actually works.
 * Kept as a plain, pure function (rather than inline in the page) so it
 * can be unit-tested against the role matrix without rendering the RSC
 * page or touching the database.
 */
export interface DashboardWidgetVisibility {
  /** Bulk Enquiries stat card + "Recent Bulk Leads" section (-> /admin/bulk-orders). */
  leads: boolean;
  /** Newsletter Subscribers stat card (-> /admin/engagement). */
  subscribers: boolean;
  /** Published Articles stat card (-> /admin/blog). */
  blog: boolean;
  /** Campaigns Pending stat card (-> /admin/engagement). */
  campaigns: boolean;
  /** Hermes Pending stat card (-> /admin/hermes). */
  hermes: boolean;
  /** Draft Products / Low-Stock Variants stat cards (-> /admin/products). */
  products: boolean;
  /** Orders Today stat card (-> /admin/orders). */
  orders: boolean;
  /** Reviews Pending stat card (-> /admin/reviews). */
  reviews: boolean;
  /** "Recent Activity" audit section (-> /admin/audit-logs). */
  audit: boolean;
}

export function getDashboardWidgetVisibility(role: AdminRole): DashboardWidgetVisibility {
  return {
    leads: hasPermission(role, "bulk-orders:manage"),
    subscribers: hasPermission(role, "engagement:manage"),
    blog: hasPermission(role, "blog:manage"),
    campaigns: hasPermission(role, "engagement:manage"),
    hermes: hasPermission(role, "hermes:manage"),
    products: hasPermission(role, "products:view"),
    orders: hasPermission(role, "orders:view"),
    reviews: hasPermission(role, "reviews:moderate"),
    audit: hasPermission(role, "audit:view"),
  };
}
