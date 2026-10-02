import type { AdminRole } from "@/generated/prisma/client";
import { hasPermission, type Permission } from "@/lib/auth/rbac";

/**
 * F-168: an AdminNotification used to render as plain text even though the
 * row's `metadata` (a JSON string written by whatever raised the alert)
 * carries exactly what's needed to open the thing it is about — a "New
 * order DK-…" alert had the order number but no way to get to the order.
 * This maps a notification's `type` + `metadata` to the admin page it
 * belongs to, and only hands the link back when the viewing role may
 * actually open that page (otherwise the link would just bounce to the
 * dashboard, the same dead-end F-162 fixed on the product list).
 *
 * Plain functions with no DB/React so the role matrix and the metadata
 * parsing are unit-testable directly.
 */

export interface NotificationLink {
  href: string;
  label: string;
}

interface LinkRule {
  permission: Permission;
  label: string;
  /** Returns the href, or null when `metadata` lacks what the link needs. */
  build: (metadata: Record<string, unknown>) => string | null;
}

/** Ids interpolated into a path must look like ids — never trust stored
 * metadata to be shaped as the writer intended. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const campaignRule: LinkRule = {
  permission: "engagement:manage",
  label: "View campaign",
  build: (metadata) => {
    const id = safeId(metadata.campaignId);
    return id ? `/admin/campaigns/${id}` : null;
  },
};

const orderRule: LinkRule = {
  permission: "orders:view",
  label: "View order",
  build: (metadata) => {
    const orderNumber = typeof metadata.orderNumber === "string" ? metadata.orderNumber.trim() : "";
    // The orders table reads `?q=` on load (see orders-table.tsx), so the
    // order number lands the admin on exactly that order's row.
    return orderNumber && orderNumber.length <= 64 ? `/admin/orders?q=${encodeURIComponent(orderNumber)}` : null;
  },
};

const LINK_RULES: Record<string, LinkRule> = {
  order_paid: orderRule,
  order_request: orderRule,
  order_created: { permission: "orders:view", label: "View orders", build: () => "/admin/orders/shopify-legacy" },
  contact_enquiry: { permission: "bulk-orders:manage", label: "View enquiry", build: () => "/admin/contact-enquiries" },
  bulk_lead: { permission: "bulk-orders:manage", label: "View enquiry", build: () => "/admin/bulk-orders" },
  campaign_dispatch: campaignRule,
  campaign_dispatch_error: campaignRule,
  hermes_campaign_draft: campaignRule,
  hermes_blog_draft: {
    permission: "blog:manage",
    label: "View draft",
    build: (metadata) => {
      const id = safeId(metadata.postId);
      return id ? `/admin/blog/${id}` : null;
    },
  },
  WEEKLY_GROWTH_REPORT: { permission: "dashboard:view", label: "View report", build: () => "/admin/reports" },
};

/** The page a notification points at for `role`, or null when it has no
 * destination, its metadata is unusable, or `role` can't open that page. */
export function resolveNotificationLink(
  role: AdminRole,
  type: string,
  metadata: string | null | undefined,
): NotificationLink | null {
  const rule = Object.hasOwn(LINK_RULES, type) ? LINK_RULES[type] : undefined;
  if (!rule || !hasPermission(role, rule.permission)) return null;
  const href = rule.build(parseMetadata(metadata));
  return href ? { href, label: rule.label } : null;
}
