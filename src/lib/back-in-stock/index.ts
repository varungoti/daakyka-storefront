import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { EMAIL_KIND, sendTransactionalEmail } from "@/lib/engagement/outbox";
import { escapeHtml } from "@/lib/email/html";
import {
  button,
  emailSiteUrl,
  loadEmailFooter,
  paragraph,
  renderEmailLayout,
  type EmailFooter,
} from "@/lib/email/layout";

/**
 * Shopify-parity gap (docs/audit-2026-09-19/storefront-ux.md — "Notify
 * me" not implemented). "Sold-out variants currently dead-end" — this
 * module is the capture ("Notify me when available") and the restock
 * detection/send.
 *
 * Restock detection is a periodic CRON SWEEP (sweepBackInStock, driven by
 * src/app/api/cron/back-in-stock/route.ts), not a hook at every
 * stock-writing call site. That choice was deliberate:
 *
 *  - Stock is written from a lot of places — admin product/variant edit,
 *    the admin "bulk set stock" action, CSV import, and order-cancellation
 *    restock (src/lib/orders/admin-orders.ts) at minimum. Hooking every one
 *    of them means every future stock-writing code path also has to
 *    remember to hook this, or restock notifications silently stop firing
 *    for whatever forgets.
 *  - No hook is actually needed: subscribeToBackInStock below only ever
 *    creates a subscription when the variant is server-verified to be
 *    unavailable (sold out, or switched off) at signup time. That means a
 *    PENDING (notifiedAt: null) subscription row is, by construction,
 *    evidence that someone is waiting on a variant that was unavailable
 *    when they asked. So "pending subscription whose variant is now
 *    purchasable" *is* the unavailable->available transition — no
 *    separate bookkeeping column or hook is needed on ProductVariant at
 *    all, and it's correct regardless of which of the several write paths
 *    brought the stock back.
 *  - The established cron convention (authorizeCron + claimCronRun/
 *    intervalRunKey, registered in vercel.json — see
 *    src/app/api/cron/drain-email-outbox/route.ts for the closest
 *    analogue) already exists for exactly this shape of "periodically
 *    reconcile something against current DB state" job.
 *
 * F-029: "can be bought" is one definition, shared with the product page
 * (isVariantInStock in src/lib/products/resolve-variant.ts, which the page
 * feeds `available = active && stock > 0`) — an active variant of an
 * ACTIVE product in an active category, with stock. The signup form is
 * shown for any variant the page treats as unavailable (sold out *or*
 * switched off), so signup accepts exactly those; the sweep only ever
 * notifies a variant that satisfies the full definition, and leaves the
 * rest of its subscriptions pending.
 *
 * Sends go through the durable transactional email outbox
 * (sendTransactionalEmail — src/lib/engagement/outbox.ts), never a
 * provider directly, so a restock notification queues (and is retried by
 * the drain-email-outbox cron) rather than vanishing while Brevo is
 * unconfigured.
 */

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Where a variant must sit for a shopper to actually reach and buy it:
 * the PDP resolves a product by slug only when it is ACTIVE and its
 * category is active (queryProductByHandleFromDb). A link to anything else
 * is a 404. */
const REACHABLE_PRODUCT = { status: "ACTIVE", category: { active: true } } as const;

export class BackInStockVariantNotFoundError extends Error {
  constructor() {
    super("This product is no longer available");
    this.name = "BackInStockVariantNotFoundError";
  }
}

/** Thrown when the client asks to be notified about a variant that is, as
 * of this server-side check, already in stock — never trust a client's
 * claim that something is sold out. */
export class BackInStockVariantInStockError extends Error {
  constructor() {
    super("This item is currently in stock");
    this.name = "BackInStockVariantInStockError";
  }
}

export interface SubscribeToBackInStockResult {
  ok: true;
}

/**
 * Anti-abuse: caller (POST /api/back-in-stock) rate-limits by IP via the
 * existing checkRateLimit/rateLimitOrResponse. De-duplication (same email +
 * variant shouldn't queue twice) is enforced by the partial unique index
 * added by raw SQL in this feature's migration
 * (BackInStockSubscription_variant_email_pending_key, `... WHERE
 * "notifiedAt" IS NULL` — mirrors JourneyEnrollment's own precedent, see
 * schema.prisma) — a duplicate signup hits that constraint and is treated
 * as a success here, exactly like journey-engine.ts's enrollInJourney
 * treats its own partial-unique-index race. Combined with returning the
 * identical `{ok: true}` shape whether the row was freshly created or
 * already existed, this also means the response never reveals whether a
 * given email had already signed up.
 */
export async function subscribeToBackInStock(
  variantId: string,
  rawEmail: string,
): Promise<SubscribeToBackInStockResult> {
  const email = normalizeEmail(rawEmail);

  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      stock: true,
      active: true,
      product: { select: { status: true, category: { select: { active: true } } } },
    },
  });
  // A draft/archived product (or one in a deactivated category) has no
  // storefront page, so there is nothing to be notified about.
  if (!variant || variant.product.status !== REACHABLE_PRODUCT.status || !variant.product.category.active) {
    throw new BackInStockVariantNotFoundError();
  }
  // Same test as the PDP: only a variant that is active AND has stock is
  // "in stock". An inactive variant with leftover stock is unavailable on
  // the page, so it must be subscribable here too (it used to 400 with
  // "currently in stock" for a form the page itself had just shown).
  if (variant.active && variant.stock > 0) throw new BackInStockVariantInStockError();

  try {
    await db.backInStockSubscription.create({
      data: { productId: variant.productId, variantId: variant.id, email },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
    // Already subscribed and still pending — no-op, and never surfaced any
    // differently to the caller than a fresh signup (see doc comment).
  }

  return { ok: true };
}

export interface SweepBackInStockResult {
  /** Distinct variants with at least one pending subscription. */
  variantsWithPendingSubscriptions: number;
  /** Of those, how many are actually back in stock right now. */
  variantsRestocked: number;
  /** Subscriptions claimed and handed to sendTransactionalEmail this run. */
  notified: number;
}

interface RestockedVariant {
  id: string;
  stock: number;
  product: { name: string; slug: string };
  size: string;
  color: string;
}

/** "Name (M / Navy)" — a variant with no colour (or no size) must not
 * render as "(M / )". */
function variantLabel(variant: RestockedVariant): string {
  const options = [variant.size, variant.color].map((part) => part.trim()).filter(Boolean);
  return options.length > 0 ? `${variant.product.name} (${options.join(" / ")})` : variant.product.name;
}

function buildRestockEmail(
  variant: RestockedVariant,
  footer: EmailFooter,
): { subject: string; html: string; text: string } {
  const url = `${emailSiteUrl()}/products/${encodeURIComponent(variant.product.slug)}`;
  const label = variantLabel(variant);
  const subject = `Back in stock: ${variant.product.name}`;
  // F-029: the name/size/colour are admin-typed free text — escaped before
  // they go near the HTML.
  const { html, text } = renderEmailLayout({
    subject,
    heading: "Back in stock",
    bodyHtml:
      paragraph(`Good news &mdash; <strong>${escapeHtml(label)}</strong> is back in stock.`) +
      button("Shop it now", url) +
      paragraph("Grab it before it sells out again."),
    bodyText: `Good news - ${label} is back in stock.\n\nShop it now: ${url}\n\nGrab it before it sells out again.`,
    footer,
  });
  return { subject, html, text };
}

/**
 * Finds every PENDING subscription whose variant currently has stock > 0,
 * queues one restock email each (via sendTransactionalEmail — see this
 * module's header comment), and marks each subscription notified.
 *
 * Concurrency-safe the same way as everywhere else in this codebase: each
 * subscription is claimed with a conditional `updateMany` (`notifiedAt:
 * null` -> now) before it's acted on, so an overlapping sweep (or a Vercel
 * retry of the same cron tick, on top of the route's own claimCronRun
 * guard) can never notify the same subscription twice. Claim-then-send
 * (rather than send-then-claim) means a subscription is "consumed" the
 * moment it's claimed, matching "one notification per subscription, then
 * it's consumed" — consumption is queuing the send, not confirmed
 * delivery, the same contract sendTransactionalEmail already has with
 * every other transactional caller in this codebase.
 */
export async function sweepBackInStock(now: Date = new Date()): Promise<SweepBackInStockResult> {
  const pending = await db.backInStockSubscription.findMany({
    where: { notifiedAt: null },
    select: { variantId: true },
    distinct: ["variantId"],
  });

  if (pending.length === 0) {
    return { variantsWithPendingSubscriptions: 0, variantsRestocked: 0, notified: 0 };
  }

  // F-029: only a variant a shopper can actually buy right now — active, in
  // an ACTIVE product in an active category (otherwise the email's link
  // 404s or lands on a size the page still shows as unavailable). A
  // subscription on anything else stays pending until that changes.
  const restockedVariants = await db.productVariant.findMany({
    where: {
      id: { in: pending.map((p) => p.variantId) },
      stock: { gt: 0 },
      active: true,
      product: REACHABLE_PRODUCT,
    },
    select: {
      id: true,
      stock: true,
      size: true,
      color: true,
      product: { select: { name: true, slug: true } },
    },
  });

  const footer = await loadEmailFooter();
  let notified = 0;
  for (const variant of restockedVariants) {
    const subscriptions = await db.backInStockSubscription.findMany({
      where: { variantId: variant.id, notifiedAt: null },
    });

    const email = buildRestockEmail(variant, footer);

    for (const subscription of subscriptions) {
      // Claim first — the CAS itself is the "consumed" marker (see doc
      // comment above). `count === 0` means another concurrent run already
      // claimed this exact row; skip it rather than sending twice.
      const claim = await db.backInStockSubscription.updateMany({
        where: { id: subscription.id, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (claim.count === 0) continue;

      await sendTransactionalEmail(
        { to: subscription.email, subject: email.subject, html: email.html, text: email.text },
        EMAIL_KIND.BACK_IN_STOCK,
      );
      notified += 1;
    }
  }

  return {
    variantsWithPendingSubscriptions: pending.length,
    variantsRestocked: restockedVariants.length,
    notified,
  };
}
