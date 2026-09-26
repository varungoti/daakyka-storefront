import "dotenv/config";
import { randomBytes } from "node:crypto";
import { blogMedia } from "../src/data/media/catalog";
import { createPrismaClient } from "../src/lib/create-prisma-client";
import { DEFAULT_ADMIN_SEED_EMAIL, isInsecureSeedPassword } from "../src/lib/auth/seed-defaults";
import { isVercel } from "../src/lib/env";
import { settingDefaults } from "../src/lib/settings";
import type { Prisma } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const prisma = createPrismaClient();

/**
 * F-223 / F-232: internal one-time markers, stored as ordinary SiteSetting
 * rows keyed under a "seed." namespace that never appears in
 * SettingValueMap (src/lib/settings/index.ts) — getSetting()/setSetting()
 * and /admin/site-controls only ever read/write the fixed keys declared
 * there, so these rows are invisible to the admin UI and safe to share the
 * table with real settings.
 */
const CONTENT_SEED_MARKER_KEY = "seed.contentSeededAt";
const LEGACY_ACCOUNTS_SEED_MARKER_KEY = "seed.legacyAccountsHandledAt";

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
      headline: "Expertly Designed, Meticulously Crafted",
      subheadline: "Quality Uniforms & Linens for Pan India",
      description:
        "Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad-based, Pan India delivery.",
      primaryCta: "Shop All Scrubs",
      secondaryCta: "Build Your Fit",
      // Phase C3: no fabricated star rating or follower count (removed
      // unverifiable claims) — ratingLabel carries a real, verifiable
      // fact instead.
      rating: "",
      ratingLabel: "Hyderabad-Based · 9+ Years of Trusted Manufacturing",
    },
  },
  {
    key: "trust-stats",
    title: "Hero Trust Stats",
    sortOrder: 2,
    content: {
      stats: [
        { value: "9+", label: "Years Manufacturing" },
        { value: "Pan India", label: "Delivery & Fulfillment" },
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

/**
 * True when `databaseUrl` points at a local Postgres — the only case
 * where a weak/default ADMIN_SEED_PASSWORD is tolerated. Matches what
 * .env.local.example, docker-compose.yml and this repo's CI and
 * testdb.mjs all actually use (localhost/127.0.0.1/::1); anything else —
 * including a Supabase or Neon host reached by running the seed directly
 * against a copied-out DATABASE_URL — is treated as remote.
 */
function isLocalDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Resolves the password to seed the SUPER_ADMIN account with.
 *
 * Against any non-local database — Vercel (preview or production), or a
 * remote DATABASE_URL run some other way — ADMIN_SEED_PASSWORD must be
 * set to a real, non-default password: the seed fails loudly rather than
 * silently falling back to, or quietly accepting, a value that's ever
 * appeared in docs, git history, or another deploy's logs (F-301). This
 * is what caught the off-Vercel run that left production's SUPER_ADMIN
 * un-rotated. Locally, an unset password is generated at random instead
 * of reusing a fixed default, so "forgetting" to set one can't quietly
 * leave a known password behind.
 */
function resolveAdminSeedPassword(): string {
  const explicit = process.env.ADMIN_SEED_PASSWORD;
  const remote = isVercel() || !isLocalDatabaseUrl(process.env.DATABASE_URL);

  if (remote) {
    if (!explicit) {
      throw new Error(
        "ADMIN_SEED_PASSWORD must be set before seeding a non-local database " +
          "(this DATABASE_URL is not localhost) — see docs/GO_LIVE_RUNBOOK.md. Generate one " +
          "with `openssl rand -base64 18`.",
      );
    }
    if (isInsecureSeedPassword(explicit)) {
      throw new Error(
        "ADMIN_SEED_PASSWORD is too short or matches a known default/leaked password. " +
          "Set a unique password of at least 12 characters.",
      );
    }
    return explicit;
  }

  if (explicit) {
    if (isInsecureSeedPassword(explicit)) {
      console.warn(
        "[seed] ADMIN_SEED_PASSWORD matches a known default/weak password — fine for local " +
          "development, but this value must never be used for a staging or production deploy.",
      );
    }
    return explicit;
  }

  return randomBytes(12).toString("base64url");
}

async function main() {
  const email = (process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL).toLowerCase();
  const password = resolveAdminSeedPassword();
  const isRemoteDatabase = isVercel() || !isLocalDatabaseUrl(process.env.DATABASE_URL);
  const existingAdmin = await prisma.user.findUnique({ where: { email } });

  // Create-only: an existing user's password, role, and active status are
  // never touched by re-seeding. A password rotation or deactivation must
  // happen through the admin UI, not by redeploying.
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Super Admin",
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
    },
  });

  if (!existingAdmin) {
    console.log("Created admin user.");
    if (!isRemoteDatabase) {
      // Only useful to print for a fresh local create against a local DB
      // — an existing account's real password is whatever it was already
      // set to, and printing this value against any remote database
      // (Vercel's build log, or a stray local run pointed at a remote
      // DATABASE_URL — see F-301) would leak it there.
      console.log(`Admin login: ${email}`);
      console.log(`Admin password: ${password}`);
    }
  } else {
    console.log(`Admin user already exists: ${email} (password unchanged).`);
    // F-301: the seed is create-only, so a configured ADMIN_SEED_PASSWORD
    // never actually rotates an existing account — warn (never log either
    // value) when the two have drifted, so an operator doesn't assume
    // setting the env var did anything.
    if (process.env.ADMIN_SEED_PASSWORD && existingAdmin.passwordHash) {
      const matches = await bcrypt.compare(process.env.ADMIN_SEED_PASSWORD, existingAdmin.passwordHash);
      if (!matches) {
        console.warn(
          "[seed] ADMIN_SEED_PASSWORD does not match the existing admin's password — the seed " +
            "did not change it (create-only). Rotate the account's password via /admin/users " +
            "if that was intended.",
        );
      }
    }
  }

  const viewerEmail = process.env.VIEWER_SEED_EMAIL;
  const viewerPassword = process.env.VIEWER_SEED_PASSWORD;

  if (viewerEmail && viewerPassword) {
    if (isRemoteDatabase && isInsecureSeedPassword(viewerPassword)) {
      throw new Error(
        "VIEWER_SEED_PASSWORD is too short or matches a known default/leaked password.",
      );
    }
    await prisma.user.upsert({
      where: { email: viewerEmail.toLowerCase() },
      update: {},
      create: {
        email: viewerEmail.toLowerCase(),
        name: "Read-only Viewer",
        passwordHash: await bcrypt.hash(viewerPassword, 12),
        role: "VIEWER",
      },
    });
  }

  // F-232: this used to deactivate these two known-compromised default
  // accounts (see docs/ADMIN_CREDENTIALS.md) unconditionally on *every*
  // deploy. That collided with ADMIN_SEED_EMAIL=admin@daakyka.com — the
  // upsert above creates that very account, and this loop would deactivate
  // it in the same run, right after "creating" it — and it silently undid
  // a SUPER_ADMIN's later manual reactivation the moment the next deploy
  // ran, with no warning. Fix: never touch an address that's actively
  // configured as a seed email, and do the rest at most once per database
  // (marker below), so a reactivation sticks across future deploys.
  const configuredSeedEmails = new Set(
    [email, viewerEmail?.toLowerCase()].filter((value): value is string => Boolean(value)),
  );
  const legacyAccountsHandled = await prisma.siteSetting.findUnique({
    where: { key: LEGACY_ACCOUNTS_SEED_MARKER_KEY },
  });
  if (!legacyAccountsHandled) {
    for (const legacyEmail of ["admin@daakyka.com", "viewer@daakyka.com"]) {
      if (configuredSeedEmails.has(legacyEmail)) continue;
      const legacyUser = await prisma.user.findUnique({ where: { email: legacyEmail } });
      if (!legacyUser || !legacyUser.active) continue;
      if (legacyUser.role === "SUPER_ADMIN") {
        const activeSuperAdmins = await prisma.user.count({
          where: { role: "SUPER_ADMIN", active: true },
        });
        if (activeSuperAdmins <= 1) {
          console.warn(
            `[seed] Not deactivating legacy account ${legacyEmail} — it is the only active SUPER_ADMIN.`,
          );
          continue;
        }
      }
      // Matches the "deactivate" path in src/app/api/admin/users/[id]/route.ts:
      // bump sessionVersion too, so any existing session for this account
      // is revoked immediately rather than staying valid until it expires.
      await prisma.user.update({
        where: { id: legacyUser.id },
        data: { active: false, sessionVersion: { increment: 1 } },
      });
    }
    await prisma.siteSetting.upsert({
      where: { key: LEGACY_ACCOUNTS_SEED_MARKER_KEY },
      update: {},
      create: { key: LEGACY_ACCOUNTS_SEED_MARKER_KEY, value: new Date().toISOString() },
    });
  }

  // Create-only from here down: homepage sections, blog posts, SEO
  // records and testimonials are all editable from /admin, and a
  // re-seed (which happens on every deploy) must never clobber those
  // edits. A record is only ever written once, on first creation.
  for (const section of defaultHomepageSections) {
    await prisma.homepageSection.upsert({
      where: { key: section.key },
      update: {},
      create: {
        key: section.key,
        title: section.title,
        sortOrder: section.sortOrder,
        content: JSON.stringify(section.content),
      },
    });
  }

  // release-hardening — configurable hero carousel: seeds three real slides
  // (Hospital Scrubs / School Uniforms / Kids Wear) via the same
  // create-only upsert as defaultHomepageSections above, so this only ever
  // writes once — a later admin edit (including emptying the slide list
  // entirely, which intentionally reverts the storefront to the legacy
  // "hero" section above — see getHeroSlidesContent() in
  // src/lib/homepage/index.ts) is never clobbered by a re-seed. This also
  // guarantees the "hero-slides" row exists before the first admin visit,
  // which PUT /api/admin/homepage/hero-slides requires: updateHomepageSection
  // uses `update`, not `upsert`, same as every other homepage section key.
  //
  // Images are never generated or uploaded here — each slide reuses
  // whatever MediaAsset already exists for that section (the homepage tile
  // slot, the section's feature-band slot, or the category's own image),
  // mirroring src/app/page.tsx's own home.tile.*-then-category.image
  // fallback chain. A section with none of those seeded yet just gets
  // `image: null`/`secondaryImage: null`, which the storefront already
  // renders as a neutral placeholder.
  type SeedMediaAsset = { id: string; url: string; alt: string | null };

  async function resolveHeroSlideImages(slug: string, bandSlot?: string) {
    const slotsToTry = [`home.tile.${slug}`, ...(bandSlot ? [bandSlot] : []), `category.${slug}`];
    const [bySlot, category] = await Promise.all([
      Promise.all(slotsToTry.map((slot) => prisma.mediaAsset.findUnique({ where: { slot } }))),
      prisma.category.findUnique({ where: { slug }, include: { image: true } }),
    ]);
    const candidates: (SeedMediaAsset | null)[] = [...bySlot, category?.image ?? null];
    const seen = new Set<string>();
    const unique: { assetId: string; url: string; alt: string }[] = [];
    for (const asset of candidates) {
      if (!asset || seen.has(asset.id)) continue;
      seen.add(asset.id);
      unique.push({ assetId: asset.id, url: asset.url, alt: asset.alt ?? "" });
    }
    return { main: unique[0] ?? null, secondary: unique[1] ?? null };
  }

  const heroSlideSeeds = [
    {
      id: "hospital-scrubs",
      slug: "for-hospitals",
      bandSlot: "home.band.hospital",
      eyebrow: "For Hospitals",
      headline: "Scrubs, Gowns & Hospital Linens",
      subheadline: "Built for Demanding Healthcare Environments",
      description:
        "Hygienic, durable scrubs, gowns, staff uniforms, and hospital linens — with department-wise color standardization and logo embroidery available.",
      primaryCta: { label: "Shop Hospital Range", href: "/for-hospitals" },
      secondaryCta: { label: "Request Bulk Quote", href: "/bulk-orders" },
    },
    {
      id: "school-uniforms",
      slug: "school-uniforms",
      bandSlot: "home.band.school",
      eyebrow: "School Uniforms",
      headline: "Uniforms Built for the Classroom and Beyond",
      subheadline: "Reflecting Institutional Pride",
      description:
        "Shirts, tunics, trousers, skirts, pinafores, made-to-measure blazers, sweaters, and sportswear — smart, comfortable uniforms for every school.",
      primaryCta: { label: "Shop School Uniforms", href: "/school-uniforms" },
      secondaryCta: { label: "Request Bulk Quote", href: "/bulk-orders" },
    },
    {
      id: "kids-wear",
      slug: "kids-wear",
      bandSlot: undefined as string | undefined,
      eyebrow: "Kids Wear",
      headline: "Comfortable, Everyday Wear for Kids",
      subheadline: "T-Shirts, Joggers, Frocks, Co-ord Sets & Hoodies",
      description:
        "Comfortable, everyday wear for kids — T-shirts, joggers, frocks, co-ord sets, and hoodies from DAAKYKA Apparels.",
      primaryCta: { label: "Shop Kids Wear", href: "/kids-wear" },
      secondaryCta: { label: "Request Bulk Quote", href: "/bulk-orders" },
    },
  ];

  const heroSlides = await Promise.all(
    heroSlideSeeds.map(async (seed) => {
      const { main, secondary } = await resolveHeroSlideImages(seed.slug, seed.bandSlot);
      return {
        id: seed.id,
        enabled: true,
        eyebrow: seed.eyebrow,
        headline: seed.headline,
        subheadline: seed.subheadline,
        description: seed.description,
        primaryCta: seed.primaryCta,
        secondaryCta: seed.secondaryCta,
        image: main,
        secondaryImage: secondary,
      };
    }),
  );

  await prisma.homepageSection.upsert({
    where: { key: "hero-slides" },
    update: {},
    create: {
      key: "hero-slides",
      title: "Hero Carousel Slides",
      sortOrder: 3,
      content: JSON.stringify({ slides: heroSlides, autoAdvanceMs: 6000 }),
    },
  });

  for (const provider of ["SHOPIFY", "BREVO", "WATI", "HERMES"] as const) {
    await prisma.integrationSetting.upsert({
      where: { provider },
      update: {},
      create: { provider, enabled: false, config: "{}" },
    });
  }

  // SiteSetting rows are also create-only: an admin's change in
  // /admin/site-controls must survive every re-seed/redeploy. Each key
  // gets its documented default (src/lib/settings) only if no row exists.
  // Unlike seedContent() below, this (like the two loops above and the
  // homepage sections/hero slides above them) runs on every deploy — a
  // setting or integration provider added after the initial deploy still
  // needs its default row created on an already-content-seeded database,
  // and none of these rows has a delete path for a re-seed to protect
  // against resurrecting.
  for (const [key, value] of Object.entries(settingDefaults)) {
    await prisma.siteSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }

  await ensureContentSeeded();

  console.log("Database seeded successfully.");
}

/**
 * F-223: everything seeded here is real, editable /admin content — blog
 * posts, segments, message templates, a campaign, customer journeys and
 * their steps, Hermes drafts, SEO records, offers and market snapshots.
 * Unlike the bootstrap items in main() above, every one of these *can* be
 * deleted or renamed by an admin, and each is only create-only *by key*:
 * a `findFirst`/`upsert` stops re-seeding from clobbering an edit, but not
 * from resurrecting something the owner deliberately removed. This must
 * therefore run at most once per database — see ensureContentSeeded(),
 * the only caller.
 */
async function seedContent(): Promise<void> {
  for (const post of seedBlogPosts) {
    await prisma.blogPostRecord.upsert({
      where: { slug: post.slug },
      update: {},
      create: {
        ...post,
        content: JSON.stringify(post.content),
      },
    });
  }

  // F-005: no seeded testimonials. These used to be four invented
  // clinicians (with Pexels stock-photo avatars) that a fresh deploy would
  // create and the storefront would show as genuine customer reviews, with
  // no way for the owner to remove them (the runtime fallback in
  // src/lib/testimonials/index.ts used to re-serve the same hardcoded list
  // whenever the DB had zero active rows). Real testimonials are entered
  // by the owner from /admin/testimonials; with none, the section hides
  // itself (see TestimonialsSection).

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
      name: "Welcome Email",
      channel: "EMAIL",
      // F-070: no HERO10 — that code was never a real Discount row, so it
      // failed at checkout for every subscriber who tried it.
      subject: "Welcome to DAAKYKA Apparels",
      body: "Hi {{first_name}},\n\nWelcome to DAAKYKA Apparels. Explore our medical scrubs and uniforms, designed for long shifts.\n\nShop now: {{shop_url}}",
      variables: JSON.stringify(["first_name", "shop_url"]),
    },
  });

  await prisma.messageTemplate.upsert({
    where: { id: "seed-bulk-followup-wa" },
    update: {},
    create: {
      id: "seed-bulk-followup-wa",
      name: "Bulk Order Acknowledgement",
      channel: "WHATSAPP",
      body: "Hi {{contact_name}}, thank you for your bulk uniform enquiry at {{organization}}. Our team will share a custom quote within 1–2 business days.",
      variables: JSON.stringify(["contact_name", "organization"]),
    },
  });

  // F-070: a distinct step 2 template — the seed used to re-send this same
  // acknowledgement 48h later, verbatim, as the "quote follow-up".
  await prisma.messageTemplate.upsert({
    where: { id: "seed-bulk-followup-quote-wa" },
    update: {},
    create: {
      id: "seed-bulk-followup-quote-wa",
      name: "Bulk Order Quote Follow-up",
      channel: "WHATSAPP",
      body: "Hi {{contact_name}}, just checking in on {{organization}}'s uniform quote — let us know if you have any questions or would like to adjust quantities or sizes before we finalize it.",
      variables: JSON.stringify(["contact_name", "organization"]),
    },
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
      // F-070: seeded DRAFT (not ACTIVE) — an ACTIVE journey sends
      // automatically the moment Brevo is enabled, with no approval step,
      // so the owner should review it first. See docs/ADMIN_CREDENTIALS.md
      // sibling doc comments in this file for why the seed can only set
      // this on a fresh journey (it's create-only).
      description: "Single welcome email on newsletter confirmation. Review, then set to Active.",
      trigger: "newsletter_signup",
      status: "DRAFT",
    },
  });

  // Kept ACTIVE, unlike the other three journeys below: this is the only
  // path that creates the AdminNotification a bulk/institutional lead
  // needs (see the "Admin notification" step), it's WhatsApp/admin-only
  // (no consumer marketing email), and
  // tests/integration/engagement-compliance.test.ts's bulk-lead coverage
  // and src/app/api/bulk-orders/route.ts / api/contact/route.ts both
  // expect a lead to actually notify the owner today.
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

  const waQuoteFollowUpTemplate = await prisma.messageTemplate.findUnique({
    where: { id: "seed-bulk-followup-quote-wa" },
  });

  await prisma.messageTemplate.upsert({
    where: { id: "seed-cart-abandon-email" },
    update: {},
    create: {
      id: "seed-cart-abandon-email",
      name: "Abandoned Cart Reminder",
      channel: "EMAIL",
      subject: "You left something in your cart — {{first_name}}",
      // F-070: no HERO10 (see the welcome template above).
      body: "Hi {{first_name}},\n\nYour DAAKYKA scrub set is still waiting for you. Complete your order: {{shop_url}}/shop",
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
      // F-070: seeded DRAFT — see welcomeJourney above.
      description: "Single reminder when email is known. Review, then set to Active.",
      trigger: "cart_abandoned",
      status: "DRAFT",
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
      // F-070: seeded DRAFT — see welcomeJourney above. Also collapsed to
      // a single thank-you step: it used to re-send the Welcome/HERO10
      // template at +168h/+720h, pitching a "first order" offer to
      // someone who had just bought.
      description: "Single thank-you email after purchase. Review, then set to Active.",
      trigger: "order_created",
      status: "DRAFT",
    },
  });

  // F-070: each journey below is one step, not several steps that all
  // reused the same template (the same email/message was going out 3-4
  // times per journey). bulk-order-followup keeps its 3 steps — they're
  // genuinely distinct content (ack, internal admin notification, quote
  // follow-up).
  const journeySteps = [
    { journeyId: welcomeJourney.id, sortOrder: 0, name: "Welcome email", delayHours: 0, channel: "EMAIL" as const, templateId: emailTemplate.id },
    { journeyId: bulkJourney.id, sortOrder: 0, name: "Lead acknowledgement", delayHours: 0, channel: "WHATSAPP" as const, templateId: waTemplate?.id },
    { journeyId: bulkJourney.id, sortOrder: 1, name: "Admin notification", delayHours: 0, channel: "ADMIN_NOTIFICATION" as const, notes: "Notify bulk order manager" },
    { journeyId: bulkJourney.id, sortOrder: 2, name: "Quote follow-up", delayHours: 48, channel: "WHATSAPP" as const, templateId: waQuoteFollowUpTemplate?.id },
    { journeyId: cartJourney.id, sortOrder: 0, name: "Cart reminder", delayHours: 1, channel: "EMAIL" as const, templateId: cartAbandonTemplate?.id },
    { journeyId: postPurchaseJourney.id, sortOrder: 0, name: "Thank you email", delayHours: 0, channel: "EMAIL" as const, templateId: postPurchaseTemplate?.id },
  ];

  for (const step of journeySteps) {
    const existing = await prisma.journeyStep.findFirst({
      where: { journeyId: step.journeyId, sortOrder: step.sortOrder },
    });
    if (!existing) {
      await prisma.journeyStep.create({ data: step });
    }
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
      update: {},
      create: { ...page, issues: "[]" },
    });
  }

  // F-070 / release-hardening business decision: no HERO10 offer claim —
  // it was never backed by a real Discount row, so it failed at checkout
  // for every shopper who tried it (see the seed-welcome-email /
  // seed-cart-abandon-email templates above).
  const offers = [
    { name: "Top + Bottom Bundle", type: "bundle", description: "Save 10% when buying a scrub top and bottom together.", config: { discount: "10%", minItems: 2 } },
    { name: "Free Shipping Threshold", type: "free_shipping", description: "Free shipping on retail orders over ₹8,299.", config: { thresholdInr: 8299 }, active: true },
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
}

/**
 * Decides whether seedContent() should run, then makes sure it never runs
 * again for this database.
 *
 * - `SEED_CONTENT=1` always forces it — for local/dev use: refilling
 *   fixtures after wiping a table, or deliberately content-seeding a
 *   database that predates the marker.
 * - Otherwise it runs exactly once: the first time this database has no
 *   marker *and* no content rows already exist (a genuinely fresh
 *   database — this is what `testdb.mjs setup` and a first-ever production
 *   deploy both hit).
 * - A database with no marker but existing content (every database seeded
 *   before this fix shipped, including production — see F-223) just gets
 *   the marker written, without calling seedContent() — seeding it again
 *   would recreate anything the owner already deleted.
 */
async function ensureContentSeeded(): Promise<void> {
  const marker = await prisma.siteSetting.findUnique({ where: { key: CONTENT_SEED_MARKER_KEY } });
  const forced = process.env.SEED_CONTENT === "1" || process.env.SEED_CONTENT === "true";

  if (marker && !forced) return;

  let shouldSeed = forced || !marker;
  if (!marker && !forced) {
    const [blogCount, offerCount, seoCount, segmentCount] = await Promise.all([
      prisma.blogPostRecord.count(),
      prisma.offerRecommendation.count(),
      prisma.seoPageRecord.count(),
      prisma.customerSegment.count(),
    ]);
    if (blogCount > 0 || offerCount > 0 || seoCount > 0 || segmentCount > 0) {
      shouldSeed = false;
      console.log(
        "[seed] Content already exists with no seed marker (a database seeded before this " +
          "fix shipped) — recording the marker without re-seeding, so nothing the owner already " +
          "deleted comes back.",
      );
    }
  }

  if (shouldSeed) {
    await seedContent();
    console.log("Seeded content (blog posts, SEO records, segments, templates, journeys, offers).");
  }

  if (!marker) {
    await prisma.siteSetting.upsert({
      where: { key: CONTENT_SEED_MARKER_KEY },
      update: {},
      create: { key: CONTENT_SEED_MARKER_KEY, value: new Date().toISOString() },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
