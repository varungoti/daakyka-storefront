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
  | "products:view"
  | "products:manage"
  | "products:publish"
  | "categories:manage"
  | "media:manage"
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
  "products:view",
  "products:manage",
  "products:publish",
  "categories:manage",
  "media:manage",
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
    // Limited to sale/announcement settings, not the full site-controls surface.
    "settings:manage",
  ],
  CONTENT_EDITOR: ["dashboard:view", "blog:manage", "testimonials:manage", "homepage:manage", "media:manage"],
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
