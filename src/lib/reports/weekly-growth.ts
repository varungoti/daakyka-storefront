import { db } from "@/lib/db";
import { buildProductInsights, summarizeInsights } from "@/lib/intelligence/product-insights";
import { getProducts } from "@/lib/products";
import { getStaticSeoAudits, summarizeSeoAudits } from "@/lib/seo/audit";

export interface WeeklyGrowthReport {
  periodDays: number;
  generatedAt: string;
  commerce: {
    orders: number;
    revenueInr: number;
    cartAbandonments: number;
    productViews: number;
  };
  leads: {
    bulkOrders: number;
    contactEnquiries: number;
    newsletterSignups: number;
  };
  engagement: {
    activeJourneyEnrollments: number;
    journeyEvents: number;
    pendingCampaigns: number;
    sentCampaigns: number;
    pendingHermesApprovals: number;
  };
  content: {
    publishedBlogPosts: number;
    seoPagesHealthy: number;
    seoPagesNeedingWork: number;
    topProductInsights: number;
  };
  topViewedProducts: { handle: string; name: string; views: number }[];
  recommendations: string[];
}

function sinceDate(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildRecommendations(input: {
  orders: number;
  cartAbandonments: number;
  pendingCampaigns: number;
  seoNeedsMeta: number;
  newLeads: number;
  pendingHermes: number;
  lowReviewInsights: number;
}): string[] {
  const items: string[] = [];

  if (input.cartAbandonments > 0 && input.orders === 0) {
    items.push("Cart abandonments recorded but no orders — verify Shopify webhook and checkout flow.");
  }
  if (input.pendingCampaigns > 0) {
    items.push(`Approve ${input.pendingCampaigns} pending campaign(s) in Engagement.`);
  }
  if (input.seoNeedsMeta > 0) {
    items.push(`Fix ${input.seoNeedsMeta} SEO page(s) flagged for metadata in SEO Manager.`);
  }
  if (input.newLeads > 0) {
    items.push(`Follow up on ${input.newLeads} new bulk lead(s) in Bulk Orders.`);
  }
  if (input.pendingHermes > 0) {
    items.push(`Review ${input.pendingHermes} Hermes recommendation(s) in the approval queue.`);
  }
  if (input.lowReviewInsights > 0) {
    items.push("Enable post-purchase review requests for products with low review volume.");
  }
  if (items.length === 0) {
    items.push("No urgent actions — continue monitoring journeys and publish one new guide or blog post.");
  }

  return items;
}

export async function buildWeeklyGrowthReport(periodDays = 7): Promise<WeeklyGrowthReport> {
  const since = sinceDate(periodDays);

  const [
    orders,
    cartAbandonments,
    productViewCount,
    productViewGroups,
    bulkOrders,
    contactEnquiries,
    newsletterSignups,
    activeEnrollments,
    journeyEvents,
    pendingCampaigns,
    sentCampaigns,
    pendingHermes,
    publishedBlogPosts,
    products,
  ] = await Promise.all([
    db.orderEvent.findMany({ where: { createdAt: { gte: since } } }),
    db.cartAbandonmentEvent.count({ where: { createdAt: { gte: since } } }),
    db.productViewEvent.count({ where: { createdAt: { gte: since } } }),
    db.productViewEvent.groupBy({
      by: ["productHandle"],
      where: { createdAt: { gte: since } },
      _count: { productHandle: true },
      orderBy: { _count: { productHandle: "desc" } },
      take: 5,
    }),
    db.bulkOrderLead.count({ where: { createdAt: { gte: since } } }),
    db.contactEnquiry.count({ where: { createdAt: { gte: since } } }),
    db.newsletterSubscriber.count({ where: { createdAt: { gte: since } } }),
    db.journeyEnrollment.count({ where: { status: "ACTIVE" } }),
    db.journeyEvent.count({ where: { createdAt: { gte: since } } }),
    db.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    db.campaign.count({ where: { status: "SENT", updatedAt: { gte: since } } }),
    db.hermesApproval.count({ where: { status: "PENDING" } }),
    db.blogPostRecord.count({ where: { status: "PUBLISHED" } }),
    getProducts(),
  ]);

  const revenueInr = orders.reduce((sum, order) => sum + (order.total ?? 0), 0);
  const insights = buildProductInsights(products);
  const insightSummary = summarizeInsights(insights);
  const seoSummary = summarizeSeoAudits(getStaticSeoAudits());

  const productMap = new Map(products.map((p) => [p.handle, p.name]));
  const topViewedProducts = productViewGroups.map((row) => ({
    handle: row.productHandle,
    name: productMap.get(row.productHandle) ?? row.productHandle,
    views: row._count.productHandle,
  }));

  const recommendations = buildRecommendations({
    orders: orders.length,
    cartAbandonments,
    pendingCampaigns,
    seoNeedsMeta: seoSummary.needsMeta,
    newLeads: bulkOrders,
    pendingHermes,
    lowReviewInsights: insightSummary.seoGaps,
  });

  return {
    periodDays,
    generatedAt: new Date().toISOString(),
    commerce: {
      orders: orders.length,
      revenueInr,
      cartAbandonments,
      productViews: productViewCount,
    },
    leads: {
      bulkOrders,
      contactEnquiries,
      newsletterSignups,
    },
    engagement: {
      activeJourneyEnrollments: activeEnrollments,
      journeyEvents,
      pendingCampaigns,
      sentCampaigns,
      pendingHermesApprovals: pendingHermes,
    },
    content: {
      publishedBlogPosts,
      seoPagesHealthy: seoSummary.ok,
      seoPagesNeedingWork: seoSummary.needsMeta + seoSummary.missingH1,
      topProductInsights: insights.length,
    },
    topViewedProducts,
    recommendations,
  };
}

export function formatWeeklyGrowthReportMarkdown(report: WeeklyGrowthReport): string {
  const lines = [
    `# DAAKYKA Weekly Growth Report`,
    ``,
    `**Period:** Last ${report.periodDays} days`,
    `**Generated:** ${new Date(report.generatedAt).toLocaleString("en-IN")}`,
    ``,
    `## Commerce`,
    `- Orders: ${report.commerce.orders}`,
    `- Revenue: ₹${report.commerce.revenueInr.toLocaleString("en-IN")}`,
    `- Cart abandonments: ${report.commerce.cartAbandonments}`,
    `- Product views: ${report.commerce.productViews}`,
    ``,
    `## Leads & Signups`,
    `- Bulk order enquiries: ${report.leads.bulkOrders}`,
    `- Contact messages: ${report.leads.contactEnquiries}`,
    `- Newsletter signups: ${report.leads.newsletterSignups}`,
    ``,
    `## Engagement`,
    `- Active journey enrollments: ${report.engagement.activeJourneyEnrollments}`,
    `- Journey events: ${report.engagement.journeyEvents}`,
    `- Campaigns pending approval: ${report.engagement.pendingCampaigns}`,
    `- Campaigns sent: ${report.engagement.sentCampaigns}`,
    `- Hermes approvals pending: ${report.engagement.pendingHermesApprovals}`,
    ``,
    `## Content & SEO`,
    `- Published blog posts: ${report.content.publishedBlogPosts}`,
    `- SEO pages healthy: ${report.content.seoPagesHealthy}`,
    `- SEO pages needing work: ${report.content.seoPagesNeedingWork}`,
    ``,
    `## Top Viewed Products`,
    ...(report.topViewedProducts.length > 0
      ? report.topViewedProducts.map((p) => `- ${p.name} (${p.views} views)`)
      : [`- No product views recorded yet`]),
    ``,
    `## Recommended Next Actions`,
    ...report.recommendations.map((r) => `- ${r}`),
  ];

  return lines.join("\n");
}
