import type { Permission } from "@/lib/auth/rbac";

export type ExtendedPermission =
  | Permission
  | "engagement:manage"
  | "testimonials:manage";

export const allPermissions: ExtendedPermission[] = [
  "dashboard:view",
  "homepage:manage",
  "blog:manage",
  "bulk-orders:manage",
  "engagement:manage",
  "testimonials:manage",
  "users:manage",
  "audit:view",
  "settings:manage",
];
