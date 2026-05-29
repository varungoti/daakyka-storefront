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
  | "settings:manage";

const rolePermissions: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: [
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
  ],
  STORE_OWNER: [
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
    "audit:view",
    "settings:manage",
  ],
  MARKETING_ADMIN: [
    "dashboard:view",
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
  ],
  SEO_MANAGER: [
    "dashboard:view",
    "homepage:manage",
    "blog:manage",
    "intelligence:view",
    "hermes:manage",
    "seo:manage",
    "market:view",
    "audit:view",
  ],
  CONTENT_EDITOR: ["dashboard:view", "blog:manage", "testimonials:manage"],
  BULK_ORDER_MANAGER: ["dashboard:view", "bulk-orders:manage"],
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
  "SEO_MANAGER",
  "CONTENT_EDITOR",
  "BULK_ORDER_MANAGER",
  "VIEWER",
];
