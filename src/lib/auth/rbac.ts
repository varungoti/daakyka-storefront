import type { AdminRole } from "@/generated/prisma/client";

export type Permission =
  | "dashboard:view"
  | "homepage:manage"
  | "blog:manage"
  | "bulk-orders:manage"
  | "engagement:manage"
  | "journeys:manage"
  | "intelligence:view"
  | "integrations:manage"
  | "hermes:manage"
  | "seo:manage"
  | "offers:manage"
  | "market:view"
  | "testimonials:manage"
  | "users:manage"
  | "audit:view"
  | "settings:manage"
  // F-061: split out of "settings:manage" — the sale banner, announcement
  // bar and header bulk-order CTA, which MARKETING_ADMIN was documented to
  // be limited to (see src/lib/settings/permissions.ts's settingPermissions
  // map). "settings:manage" now covers everything else: shipping rates,
  // public contact details/order-alert inbox, and page toggles.
  | "settings:marketing"
  | "products:view"
  | "products:manage"
  | "products:publish"
  | "categories:manage"
  | "media:manage"
  // F-291: read-only access to the media library, separate from
  // "media:manage" (upload/delete) — lets a role that can edit content
  // (homepage hero slides, etc.) pick an existing image without also being
  // able to upload or remove assets.
  | "media:view"
  | "ai:generate"
  | "reviews:moderate"
  | "orders:view"
  | "orders:manage"
  | "customers:view"
  | "customers:manage"
  | "shopify:sync";

const superAdminPermissions: Permission[] = [
  "dashboard:view",
  "homepage:manage",
  "blog:manage",
  "bulk-orders:manage",
  "engagement:manage",
  "journeys:manage",
  "intelligence:view",
  "integrations:manage",
  "hermes:manage",
  "seo:manage",
  "offers:manage",
  "market:view",
  "testimonials:manage",
  "users:manage",
  "audit:view",
  "settings:manage",
  "settings:marketing",
  "products:view",
  "products:manage",
  "products:publish",
  "categories:manage",
  "media:manage",
  "media:view",
  "ai:generate",
  "reviews:moderate",
  "orders:view",
  "orders:manage",
  "customers:view",
  "customers:manage",
  "shopify:sync",
];

const rolePermissions: Record<AdminRole, Permission[]> = {
  // All permissions.
  SUPER_ADMIN: superAdminPermissions,
  // Everything SUPER_ADMIN has, except managing other admin users.
  STORE_OWNER: superAdminPermissions.filter((permission) => permission !== "users:manage"),
  // Adds or edits products and images but can't publish.
  CATALOG_MANAGER: [
    "dashboard:view",
    "products:view",
    "products:manage",
    "categories:manage",
    "media:manage",
    "media:view",
    "ai:generate",
  ],
  // Orders, customers (view), bulk-orders.
  ORDER_MANAGER: [
    "dashboard:view",
    "orders:view",
    "orders:manage",
    "customers:view",
    "bulk-orders:manage",
  ],
  MARKETING_ADMIN: [
    "dashboard:view",
    "homepage:manage",
    "blog:manage",
    "engagement:manage",
    "journeys:manage",
    "intelligence:view",
    "hermes:manage",
    "seo:manage",
    "offers:manage",
    "market:view",
    "testimonials:manage",
    "audit:view",
    // F-061: this used to be the blanket "settings:manage", with only a
    // comment claiming the narrower scope — nothing enforced it, so this
    // role could change shipping rates, the public contact phone/WhatsApp/
    // email, and the admin order-alert inbox. "settings:marketing" is
    // checked per-key by settingPermissions (src/lib/settings/permissions.ts)
    // against the sale banner, announcement bar and header bulk-order CTA
    // only.
    "settings:marketing",
    // F-291: can browse (not upload/delete) the media library to pick a
    // homepage hero-slide image, which this role already manages via
    // "homepage:manage".
    "media:view",
  ],
  CONTENT_EDITOR: [
    "dashboard:view",
    "blog:manage",
    "testimonials:manage",
    "homepage:manage",
    "media:manage",
    "media:view",
  ],
  BULK_ORDER_MANAGER: ["dashboard:view", "bulk-orders:manage"],
  SEO_MANAGER: [
    "dashboard:view",
    "homepage:manage",
    "blog:manage",
    "intelligence:view",
    "hermes:manage",
    "seo:manage",
    "market:view",
    "audit:view",
    "products:view",
    // F-291: can browse (not upload/delete) the media library to pick a
    // homepage hero-slide image, which this role already manages via
    // "homepage:manage".
    "media:view",
  ],
  // Orders view, customers view, reviews moderate, enquiries.
  SUPPORT_AGENT: [
    "dashboard:view",
    "orders:view",
    "customers:view",
    "reviews:moderate",
    "bulk-orders:manage",
  ],
  VIEWER: ["dashboard:view", "intelligence:view", "audit:view"],
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function formatRole(role: AdminRole): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const adminRoles: AdminRole[] = [
  "SUPER_ADMIN",
  "STORE_OWNER",
  "MARKETING_ADMIN",
  "CATALOG_MANAGER",
  "ORDER_MANAGER",
  "SEO_MANAGER",
  "CONTENT_EDITOR",
  "BULK_ORDER_MANAGER",
  "SUPPORT_AGENT",
  "VIEWER",
];
