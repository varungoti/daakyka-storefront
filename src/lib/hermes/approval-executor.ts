import { daakykaMedia } from "@/data/media/catalog";
import { db } from "@/lib/db";
import type { HermesApproval, HermesApprovalStatus, Prisma } from "@/generated/prisma/client";

export interface ApprovalExecutionResult {
  ok: boolean;
  action?: string;
  entityId?: string;
  message?: string;
}

export interface ReviewHermesApprovalResult {
  approval: HermesApproval;
  execution: ApprovalExecutionResult | null;
  /** false when the approval had already been reviewed and this call was a no-op. */
  transitioned: boolean;
}

/**
 * Transitions an approval out of PENDING and, for APPROVED, runs its
 * side effects exactly once. The transition is conditioned on the row
 * still being PENDING (an atomic updateMany) so a duplicate call — a
 * double-click, a retried request, or a second concurrent PATCH — is a
 * DB-level no-op instead of re-running executeHermesApproval, which is
 * what used to create duplicate Campaign rows.
 */
export async function reviewHermesApproval(
  approvalId: string,
  status: HermesApprovalStatus,
  reviewerId: string,
): Promise<ReviewHermesApprovalResult | null> {
  const { count } = await db.hermesApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: { status, reviewedBy: reviewerId, reviewedAt: new Date() },
  });

  if (count === 0) {
    const existing = await db.hermesApproval.findUnique({ where: { id: approvalId } });
    if (!existing) return null;
    return {
      approval: existing,
      execution: (existing.executionResult as ApprovalExecutionResult | null) ?? null,
      transitioned: false,
    };
  }

  let execution: ApprovalExecutionResult | null = null;
  let approval = await db.hermesApproval.findUniqueOrThrow({ where: { id: approvalId } });
  if (status === "APPROVED") {
    execution = await executeHermesApproval(approvalId);
    approval = await db.hermesApproval.update({
      where: { id: approvalId },
      data: { executionResult: execution as unknown as Prisma.InputJsonValue },
    });
  }

  return { approval, execution, transitioned: true };
}

export async function executeHermesApproval(approvalId: string): Promise<ApprovalExecutionResult> {
  const approval = await db.hermesApproval.findUnique({
    where: { id: approvalId },
    include: { task: true },
  });

  if (!approval || approval.status !== "APPROVED") {
    return { ok: false, message: "Approval not found or not approved" };
  }

  let payload: Record<string, unknown> = {};
  if (approval.payload) {
    try {
      payload = JSON.parse(approval.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  switch (approval.type) {
    case "blog_draft": {
      const slug = String(payload.slug ?? approval.title.toLowerCase().replace(/\s+/g, "-"));
      const existing = await db.blogPostRecord.findUnique({ where: { slug } });
      if (existing) {
        return { ok: true, action: "blog_draft_exists", entityId: existing.id };
      }

      const post = await db.blogPostRecord.create({
        data: {
          slug,
          title: String(payload.metaTitle ?? approval.title.replace(/^Blog:\s*/i, "")),
          excerpt: approval.summary,
          category: "Institutional",
          author: "DAAKYKA Editorial",
          publishedAt: new Date(),
          readTime: "5 min read",
          image: daakykaMedia.hospitalUniforms,
          content: String(payload.draftContent ?? `${approval.summary}\n\nDraft generated from Hermes approval.`),
          status: "DRAFT",
        },
      });

      await db.adminNotification.create({
        data: {
          title: "Blog draft created from Hermes",
          body: `"${post.title}" is ready in CMS for review.`,
          type: "hermes_blog_draft",
          metadata: JSON.stringify({ postId: post.id, slug: post.slug }),
        },
      });

      return { ok: true, action: "blog_draft_created", entityId: post.id };
    }

    case "campaign_draft": {
      const campaignName = approval.title.replace(/^Campaign:\s*/i, "");
      // Dedupe by name, the same natural key executeHermesApproval derives
      // deterministically from the approval title — mirrors the blog_draft
      // dedupe-by-slug above, so a second execution of this approval is a no-op.
      const existingCampaign = await db.campaign.findFirst({ where: { name: campaignName } });
      if (existingCampaign) {
        return { ok: true, action: "campaign_draft_exists", entityId: existingCampaign.id };
      }

      const segmentSlug = String(payload.segment ?? "newsletter-subscribers");
      const segment = await db.customerSegment.findUnique({ where: { slug: segmentSlug } });
      const channel = payload.channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL";

      const campaign = await db.campaign.create({
        data: {
          name: campaignName,
          channel,
          status: "PENDING_APPROVAL",
          segmentId: segment?.id,
          notes: approval.summary,
        },
      });

      await db.adminNotification.create({
        data: {
          title: "Campaign draft created from Hermes",
          body: `"${campaign.name}" awaits approval in Campaign Planner.`,
          type: "hermes_campaign_draft",
          metadata: JSON.stringify({ campaignId: campaign.id }),
        },
      });

      return { ok: true, action: "campaign_draft_created", entityId: campaign.id };
    }

    case "daily_seo_health_scan":
    case "weekly_competitor_scan": {
      await db.adminNotification.create({
        data: {
          title: `Hermes ${approval.type.replace(/_/g, " ")}`,
          body: approval.summary,
          type: approval.type,
          metadata: approval.payload ?? "{}",
        },
      });
      return { ok: true, action: "notification_created", message: approval.summary };
    }

    default: {
      await db.adminNotification.create({
        data: {
          title: `Hermes approval executed: ${approval.type}`,
          body: approval.summary,
          type: "hermes_generic",
          metadata: approval.payload ?? "{}",
        },
      });
      return { ok: true, action: "generic_notification", message: approval.summary };
    }
  }
}
