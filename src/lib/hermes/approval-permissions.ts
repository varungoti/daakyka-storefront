import type { AdminRole } from "@/generated/prisma/client";
import { hasPermission, type Permission } from "@/lib/auth/rbac";

/**
 * F-293: PATCH /api/admin/hermes/approvals/[id] only ever checked
 * `hermes:manage`, but approving an item makes executeHermesApproval create a
 * real record directly — a Campaign (bypassing POST /api/admin/campaigns'
 * `engagement:manage` check) or a BlogPostRecord (bypassing the blog routes'
 * `blog:manage` check). SEO_MANAGER holds `hermes:manage` without
 * `engagement:manage`, so it could approve a campaign draft into existence
 * that it then couldn't even open (/admin/campaigns redirects it away).
 * Approving an item therefore requires the permission of the entity it
 * creates. Types that only log a notification need nothing beyond
 * `hermes:manage`. Rejecting creates nothing, so it needs nothing extra.
 */
const APPROVAL_TYPE_PERMISSIONS: Partial<Record<string, Permission>> = {
  campaign_draft: "engagement:manage",
  blog_draft: "blog:manage",
};

/** The extra permission approving this Hermes item type requires, if any. */
export function requiredPermissionForApproval(type: string): Permission | undefined {
  return APPROVAL_TYPE_PERMISSIONS[type];
}

/** Whether `role` may APPROVE a Hermes item of this type. */
export function canApproveHermesApproval(role: AdminRole, type: string): boolean {
  const required = requiredPermissionForApproval(type);
  return required === undefined || hasPermission(role, required);
}
