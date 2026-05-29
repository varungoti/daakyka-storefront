import { daakykaMedia } from "@/data/media/catalog";
import { db } from "@/lib/db";

export interface ApprovalExecutionResult {
  ok: boolean;
  action?: string;
  entityId?: string;
  message?: string;
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
      const segmentSlug = String(payload.segment ?? "newsletter-subscribers");
      const segment = await db.customerSegment.findUnique({ where: { slug: segmentSlug } });
      const channel = payload.channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL";

      const campaign = await db.campaign.create({
        data: {
          name: approval.title.replace(/^Campaign:\s*/i, ""),
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
      return { ok: true, action: "notification_created" };
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
      return { ok: true, action: "generic_notification" };
    }
  }
}
