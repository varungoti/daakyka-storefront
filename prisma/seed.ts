import "dotenv/config";
import {
  blogMedia,
  scrubMedia,
  testimonialAvatars,
} from "../src/data/media/catalog";
import { createPrismaClient } from "../src/lib/create-prisma-client";
import {
  DEFAULT_ADMIN_SEED_EMAIL,
  DEFAULT_ADMIN_SEED_PASSWORD,
  DEFAULT_VIEWER_SEED_EMAIL,
  DEFAULT_VIEWER_SEED_PASSWORD,
} from "../src/lib/auth/seed-defaults";
import bcrypt from "bcryptjs";

const prisma = createPrismaClient();

const defaultHomepageSections = [
  {
    key: "announcement",
    title: "Announcement Bar",
    sortOrder: 0,
    content: {
      messages: [
        "Free Shipping on Orders Over ₹8,000",
        "30-Day Easy Returns",
        "Designed for Heroes",
      ],
    },
  },
  {
    key: "hero",
    title: "Hero Section",
    sortOrder: 1,
    content: {
      eyebrow: "Welcome to DAAKYKA",
      headline: "The Future of Medical Commerce",
      subheadline: "Futuristic. Functional. Flawless.",
      description:
        "Premium scrubs engineered with advanced fabric technology for healthcare professionals who do more.",
      primaryCta: "Shop All Scrubs",
      secondaryCta: "Build Your Fit",
      rating: "4.9/5",
      ratingLabel: "Trusted by 20,000+ healthcare professionals",
    },
  },
  {
    key: "trust-stats",
    title: "Hero Trust Stats",
    sortOrder: 2,
    content: {
      stats: [
        { value: "20,000+", label: "Healthcare Professionals" },
        { value: "4.9/5", label: "Customer Rating" },
        { value: "100%", label: "Secure Checkout" },
      ],
    },
  },
];

const seedBlogPosts = [
  {
    slug: "how-to-choose-medical-scrubs",
    title: "How to Choose Medical Scrubs That Last Long Shifts",
    excerpt:
      "Fit, fabric, and function — the three factors that matter most when choosing scrubs for demanding clinical work.",
    category: "Fit Guide",
    author: "DAAKYKA Editorial",
    publishedAt: new Date("2026-05-20"),
    readTime: "6 min read",
    image: blogMedia.chooseScrubs,
    content: [
      "Choosing scrubs is about more than color. Healthcare professionals need garments that breathe, stretch, and maintain a professional appearance through long shifts.",
      "Start with fabric technology. 4-way stretch supports dynamic movement, while moisture-wicking and antimicrobial finishes improve comfort and freshness.",
      "Next, evaluate fit. A relaxed top with a tapered jogger may suit active roles, while straight pants offer a more traditional silhouette.",
      "Finally, consider care requirements. Easy-care fabrics reduce time spent maintaining uniforms outside of work.",
    ],
    status: "PUBLISHED" as const,
  },
  {
    slug: "best-colors-for-hospital-uniforms",
    title: "Best Colors for Hospital Uniforms",
    excerpt:
      "Color psychology, department standards, and practical considerations for hospital apparel programs.",
    category: "Style",
    author: "DAAKYKA Editorial",
    publishedAt: new Date("2026-05-12"),
    readTime: "5 min read",
    image: blogMedia.hospitalColors,
    content: [
      "Color choices in healthcare settings influence patient perception, team cohesion, and practical maintenance.",
      "Soft lilac and navy tones communicate calm professionalism, while deeper plum accents signal premium bespoke collections.",
      "For bulk hospital programs, standardized palettes simplify procurement and reinforce institutional identity.",
    ],
    status: "PUBLISHED" as const,
  },
  {
    slug: "caring-for-performance-scrubs",
    title: "Caring for Performance Scrubs",
    excerpt:
      "Extend the life of liquid-repellent and antimicrobial fabrics with the right wash and care routine.",
    category: "Fabric",
    author: "DAAKYKA Editorial",
    publishedAt: new Date("2026-05-05"),
    readTime: "4 min read",
    image: blogMedia.careScrubs,
    content: [
      "Performance scrubs require gentle care to preserve stretch, repellency, and antimicrobial finishes.",
      "Wash in cold water with mild detergent and avoid fabric softeners that can coat technical fibers.",
      "Tumble dry on low heat or line dry to maintain shape and fabric performance over time.",
    ],
    status: "PUBLISHED" as const,
  },
];

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD ?? DEFAULT_ADMIN_SEED_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "SUPER_ADMIN", active: true, name: "Super Admin" },
    create: {
      email,
      name: "Super Admin",
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  const viewerEmail = process.env.VIEWER_SEED_EMAIL ?? DEFAULT_VIEWER_SEED_EMAIL;
  const viewerPassword = process.env.VIEWER_SEED_PASSWORD ?? DEFAULT_VIEWER_SEED_PASSWORD;
  const viewerHash = await bcrypt.hash(viewerPassword, 12);

  await prisma.user.upsert({
    where: { email: viewerEmail },
    update: { role: "VIEWER", passwordHash: viewerHash, active: true },
    create: {
      email: viewerEmail,
      name: "Read-only Viewer",
      passwordHash: viewerHash,
      role: "VIEWER",
    },
  });

  for (const legacyEmail of ["admin@daakyka.com", "viewer@daakyka.com"]) {
    await prisma.user.updateMany({
      where: { email: legacyEmail },
      data: { active: false },
    });
  }

  for (const section of defaultHomepageSections) {
    await prisma.homepageSection.upsert({
      where: { key: section.key },
      update: {
        title: section.title,
        sortOrder: section.sortOrder,
        content: JSON.stringify(section.content),
      },
      create: {
        key: section.key,
        title: section.title,
        sortOrder: section.sortOrder,
        content: JSON.stringify(section.content),
      },
    });
  }

  for (const post of seedBlogPosts) {
    await prisma.blogPostRecord.upsert({
      where: { slug: post.slug },
      update: {
        title: post.title,
        excerpt: post.excerpt,
        category: post.category,
        author: post.author,
        readTime: post.readTime,
        image: post.image,
        status: post.status,
      },
      create: {
        ...post,
        content: JSON.stringify(post.content),
      },
    });
  }

  const seedTestimonials = [
    {
      quote:
        "The softest, most comfortable scrubs I've ever worn. The 4-way stretch is a game changer during 12 hour shifts!",
      name: "Dr. Amanda Lee",
      title: "Emergency Physician",
      rating: 5,
      avatar: testimonialAvatars.amanda,
      featured: true,
      sortOrder: 0,
    },
    {
      quote:
        "Finally scrubs that look professional and feel premium. The liquid repellent fabric has saved me more than once.",
      name: "Nurse Priya Sharma",
      title: "ICU Nurse",
      rating: 5,
      avatar: testimonialAvatars.priya,
      featured: false,
      sortOrder: 1,
    },
    {
      quote:
        "Our hospital ordered bespoke sets for the entire surgical team. The quality and fit consistency were outstanding.",
      name: "Dr. Marcus Chen",
      title: "Chief of Surgery",
      rating: 5,
      avatar: testimonialAvatars.marcus,
      featured: false,
      sortOrder: 2,
    },
    {
      quote:
        "I love the mix and match builder — being able to customize my set with embroidery makes it truly mine.",
      name: "Dr. Sarah Okonkwo",
      title: "Pediatrician",
      rating: 5,
      avatar: testimonialAvatars.sarah,
      featured: false,
      sortOrder: 3,
    },
  ];

  for (const testimonial of seedTestimonials) {
    const existing = await prisma.testimonialRecord.findFirst({
      where: { name: testimonial.name },
    });
    if (existing) {
      await prisma.testimonialRecord.update({
        where: { id: existing.id },
        data: testimonial,
      });
    } else {
      await prisma.testimonialRecord.create({ data: testimonial });
    }
  }

  const segments = [
    {
      name: "Newsletter Subscribers",
      slug: "newsletter-subscribers",
      description: "Customers who opted in via footer or checkout.",
      criteria: { source: "newsletter", consent: true },
    },
    {
      name: "Bulk Order Leads",
      slug: "bulk-order-leads",
      description: "Hospitals and teams who submitted bulk enquiries.",
      criteria: { leadType: "bulk_order" },
    },
    {
      name: "High-Intent Shoppers",
      slug: "high-intent-shoppers",
      description: "Users who viewed mix & match or bespoke pages.",
      criteria: { pages: ["/mix-and-match", "/shop/bespoke"] },
    },
  ];

  for (const segment of segments) {
    await prisma.customerSegment.upsert({
      where: { slug: segment.slug },
      update: {},
      create: { ...segment, criteria: JSON.stringify(segment.criteria) },
    });
  }

  const emailTemplate = await prisma.messageTemplate.upsert({
    where: { id: "seed-welcome-email" },
    update: {},
    create: {
      id: "seed-welcome-email",
      name: "Welcome — 10% Off First Order",
      channel: "EMAIL",
      subject: "Welcome to DAAKYKA — Your 10% Hero Discount",
      body: "Hi {{first_name}},\n\nWelcome to DAAKYKA Apparels. Use code HERO10 for 10% off your first scrub set.\n\nShop best sellers: {{shop_url}}",
      variables: JSON.stringify(["first_name", "shop_url"]),
    },
  });

  await prisma.messageTemplate.upsert({
    where: { id: "seed-bulk-followup-wa" },
    update: {},
    create: {
      id: "seed-bulk-followup-wa",
      name: "Bulk Order Follow-up",
      channel: "WHATSAPP",
      body: "Hi {{contact_name}}, thank you for your bulk uniform enquiry at {{organization}}. Our team will share a custom quote within 1–2 business days.",
      variables: JSON.stringify(["contact_name", "organization"]),
    },
  });

  const bulkSegment = await prisma.customerSegment.findUnique({
    where: { slug: "bulk-order-leads" },
  });

  const newsletterSegment = await prisma.customerSegment.findUnique({
    where: { slug: "newsletter-subscribers" },
  });

  await prisma.campaign.upsert({
    where: { id: "seed-welcome-campaign" },
    update: {},
    create: {
      id: "seed-welcome-campaign",
      name: "Welcome Series — Week 1",
      channel: "EMAIL",
      status: "PENDING_APPROVAL",
      segmentId: newsletterSegment?.id,
      templateId: emailTemplate.id,
      notes: "Auto-draft — requires approval before send.",
    },
  });

  const welcomeJourney = await prisma.customerJourney.upsert({
    where: { slug: "welcome-series" },
    update: {},
    create: {
      name: "Welcome Journey",
      slug: "welcome-series",
      description: "Day 0 welcome, Day 2 best sellers, Day 5 fabric science, Day 7 offer.",
      trigger: "newsletter_signup",
      status: "ACTIVE",
    },
  });

  const bulkJourney = await prisma.customerJourney.upsert({
    where: { slug: "bulk-order-followup" },
    update: {},
    create: {
      name: "Bulk Order Follow-up",
      slug: "bulk-order-followup",
      description: "Acknowledgement and quote follow-up for institutional leads.",
      trigger: "bulk_lead_created",
      status: "ACTIVE",
    },
  });

  const waTemplate = await prisma.messageTemplate.findUnique({
    where: { id: "seed-bulk-followup-wa" },
  });

  await prisma.messageTemplate.upsert({
    where: { id: "seed-cart-abandon-email" },
    update: {},
    create: {
      id: "seed-cart-abandon-email",
      name: "Abandoned Cart Reminder",
      channel: "EMAIL",
      subject: "You left something in your cart — {{first_name}}",
      body: "Hi {{first_name}},\n\nYour DAAKYKA scrub set is waiting. Complete your order: {{shop_url}}/shop\n\nUse code HERO10 on your first purchase.",
      variables: JSON.stringify(["first_name", "shop_url"]),
    },
  });

  const cartAbandonTemplate = await prisma.messageTemplate.findUnique({
    where: { id: "seed-cart-abandon-email" },
  });

  const cartJourney = await prisma.customerJourney.upsert({
    where: { slug: "abandoned-cart" },
    update: {},
    create: {
      name: "Abandoned Cart Journey",
      slug: "abandoned-cart",
      description: "1h reminder, 24h benefit nudge, 48h offer (when email known).",
      trigger: "cart_abandoned",
      status: "ACTIVE",
    },
  });

  await prisma.messageTemplate.upsert({
    where: { id: "seed-post-purchase-email" },
    update: {},
    create: {
      id: "seed-post-purchase-email",
      name: "Post-Purchase Thank You",
      channel: "EMAIL",
      subject: "Thank you for your order, {{first_name}}!",
      body: "Hi {{first_name}},\n\nThank you for choosing DAAKYKA Apparels. Your order is being prepared with care.\n\nCare tip: Wash in cold water and avoid fabric softener on performance fabrics.\n\nShop again: {{shop_url}}/shop",
      variables: JSON.stringify(["first_name", "shop_url"]),
    },
  });

  const postPurchaseTemplate = await prisma.messageTemplate.findUnique({
    where: { id: "seed-post-purchase-email" },
  });

  const postPurchaseJourney = await prisma.customerJourney.upsert({
    where: { slug: "post-purchase" },
    update: {},
    create: {
      name: "Post-Purchase Journey",
      slug: "post-purchase",
      description: "Thank you, care tips, review request, cross-sell, repeat reminder.",
      trigger: "order_created",
      status: "ACTIVE",
    },
  });

  const journeySteps = [
    { journeyId: welcomeJourney.id, sortOrder: 0, name: "Welcome email", delayHours: 0, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: welcomeJourney.id, sortOrder: 1, name: "Best sellers spotlight", delayHours: 48, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: welcomeJourney.id, sortOrder: 2, name: "Fabric science guide", delayHours: 120, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: welcomeJourney.id, sortOrder: 3, name: "First purchase offer", delayHours: 168, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: bulkJourney.id, sortOrder: 0, name: "Lead acknowledgement", delayHours: 0, channel: "WHATSAPP" as const, templateId: waTemplate?.id },
    { journeyId: bulkJourney.id, sortOrder: 1, name: "Admin notification", delayHours: 0, channel: "ADMIN_NOTIFICATION" as const, notes: "Notify bulk order manager" },
    { journeyId: bulkJourney.id, sortOrder: 2, name: "Quote follow-up", delayHours: 48, channel: "WHATSAPP" as const, templateId: waTemplate?.id },
    { journeyId: cartJourney.id, sortOrder: 0, name: "Cart reminder", delayHours: 1, channel: "EMAIL" as const, templateId: cartAbandonTemplate?.id },
    { journeyId: cartJourney.id, sortOrder: 1, name: "Benefit-led nudge", delayHours: 24, channel: "EMAIL" as const, templateId: cartAbandonTemplate?.id },
    { journeyId: cartJourney.id, sortOrder: 2, name: "Offer reminder", delayHours: 48, channel: "EMAIL" as const, templateId: cartAbandonTemplate?.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 0, name: "Thank you email", delayHours: 0, channel: "EMAIL" as const, templateId: postPurchaseTemplate?.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 1, name: "Care instructions", delayHours: 24, channel: "EMAIL" as const, templateId: postPurchaseTemplate?.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 2, name: "Review request", delayHours: 72, channel: "EMAIL" as const, templateId: postPurchaseTemplate?.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 3, name: "Cross-sell spotlight", delayHours: 168, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 4, name: "Repeat purchase reminder", delayHours: 720, channel: "EMAIL" as const, templateId: emailTemplate.id },
  ];

  for (const step of journeySteps) {
    const existing = await prisma.journeyStep.findFirst({
      where: { journeyId: step.journeyId, sortOrder: step.sortOrder },
    });
    if (!existing) {
      await prisma.journeyStep.create({ data: step });
    }
  }

  for (const provider of ["SHOPIFY", "BREVO", "WATI", "HERMES"] as const) {
    await prisma.integrationSetting.upsert({
      where: { provider },
      update: {},
      create: { provider, enabled: false, config: "{}" },
    });
  }

  const seoTask = await prisma.hermesTask.upsert({
    where: { id: "seed-hermes-seo-scan" },
    update: {},
    create: {
      id: "seed-hermes-seo-scan",
      type: "daily_seo_health_scan",
      status: "COMPLETED",
      mode: "SUGGEST_ONLY",
      output: JSON.stringify({ pagesChecked: 12, issues: 3 }),
      completedAt: new Date(),
    },
  });

  await prisma.hermesApproval.upsert({
    where: { id: "seed-hermes-blog-draft" },
    update: {},
    create: {
      id: "seed-hermes-blog-draft",
      taskId: seoTask.id,
      type: "blog_draft",
      title: "Blog: How to Care for Hospital Linens",
      summary: "Keyword gap identified for institutional buyers — draft ready for review.",
      payload: JSON.stringify({
        slug: "how-to-care-for-hospital-linens",
        metaTitle: "Hospital Linen Care Guide | DAAKYKA",
      }),
      status: "PENDING",
    },
  });

  await prisma.hermesApproval.upsert({
    where: { id: "seed-hermes-campaign-draft" },
    update: {},
    create: {
      id: "seed-hermes-campaign-draft",
      type: "campaign_draft",
      title: "Campaign: Monsoon Scrubs Spotlight",
      summary: "WhatsApp + email draft for moisture-wicking collection — pending approval.",
      payload: JSON.stringify({ segment: "high-intent-shoppers", channel: "EMAIL" }),
      status: "PENDING",
    },
  });

  const seoPages = [
    { path: "/", title: "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India", metaDescription: "Expertly designed medical scrubs and institutional uniforms. Pan India delivery by Babaji Enterprises.", h1: "Expertly Designed, Meticulously Crafted", status: "ok" },
    { path: "/shop", title: "Shop All Scrubs", metaDescription: "Browse premium medical scrubs with filters for color, size, fabric technology, and price.", h1: "Shop All Scrubs", status: "ok" },
    { path: "/bulk-orders", title: "Bulk Orders", metaDescription: "Hospital and institutional uniform quotes with logo embroidery and Pan India fulfillment.", h1: "Uniforms for Healthcare Teams", status: "ok" },
  ];

  for (const page of seoPages) {
    await prisma.seoPageRecord.upsert({
      where: { path: page.path },
      update: { title: page.title, metaDescription: page.metaDescription, h1: page.h1, status: page.status },
      create: { ...page, issues: "[]" },
    });
  }

  const offers = [
    { name: "Top + Bottom Bundle", type: "bundle", description: "Save 10% when buying a scrub top and bottom together.", config: { discount: "10%", minItems: 2 } },
    { name: "Free Shipping Threshold", type: "free_shipping", description: "Free shipping on retail orders over ₹8,299.", config: { thresholdInr: 8299 }, active: true },
    { name: "First Purchase — HERO10", type: "first_purchase", description: "10% off first order for newsletter subscribers.", config: { code: "HERO10" }, active: true },
    { name: "Institutional Bulk Pricing", type: "bulk", description: "Volume discounts for hospitals, schools, and corporate teams.", config: { minStaff: 25 }, active: true },
    { name: "Festival Scrubs Spotlight", type: "festival", description: "Seasonal campaign offer — requires campaign approval before send.", config: { season: "monsoon" }, active: false },
  ];

  for (const offer of offers) {
    const existing = await prisma.offerRecommendation.findFirst({ where: { name: offer.name } });
    if (!existing) {
      await prisma.offerRecommendation.create({
        data: { ...offer, config: JSON.stringify(offer.config) },
      });
    }
  }

  const marketSnapshots = [
    { competitor: "Knyamed", category: "Fabric Tech", observation: "Strong ecoflex™ and 4-way stretch category navigation — opportunity for deeper science content hub." },
    { competitor: "GetNovora", category: "Positioning", observation: "Color-led shopping and WhatsApp access — match with premium UX and institutional bulk flows." },
    { competitor: "Industry", category: "Pricing", observation: "Mid-tier scrubs cluster ₹1,499–₹2,499 — bespoke and institutional tiers remain differentiation lever." },
  ];

  for (const snap of marketSnapshots) {
    const existing = await prisma.marketSnapshot.findFirst({
      where: { competitor: snap.competitor, category: snap.category },
    });
    if (!existing) {
      await prisma.marketSnapshot.create({ data: snap });
    }
  }

  console.log("Database seeded successfully.");
  console.log(`Admin login: ${email}`);
  console.log(`Admin password: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
