import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { productCacheTag } from "@/lib/products";

/**
 * Phase D2: customer-authored review creation (server-side only — never
 * trusts a client-supplied customerId, productId ownership, or
 * verifiedPurchase flag; every check here re-reads the DB).
 */

// The order statuses D3's create-order.ts treats as "the purchase actually
// went through" — a Razorpay order only ever reaches PAID once payment is
// verified (see /api/checkout/verify), and an ORDER_REQUEST order (no
// online payment gate) is created straight into PROCESSING, decrementing
// stock immediately, so it's just as much a real commitment as PAID. Kept
// as its own named export so it's the single place this definition lives
// — if Phase D4 introduces further fulfillment states (SHIPPED, DELIVERED)
// as *later* transitions of an already-PAID order, they're already
// downstream of PAID and don't need adding here; if D4 ever changes what
// "counts as purchased" means, update this set rather than duplicating it.
export const PURCHASE_COUNTING_ORDER_STATUSES = new Set<OrderStatus>(["PAID", "PROCESSING"]);

export const REVIEW_TITLE_MIN = 4;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_MAX_PHOTOS = 3;

export class ProductNotFoundError extends Error {
  constructor() {
    super("Product not found");
    this.name = "ProductNotFoundError";
  }
}

export class ProductNotActiveError extends Error {
  constructor() {
    super("This product isn't available for review");
    this.name = "ProductNotActiveError";
  }
}

export class AlreadyReviewedError extends Error {
  constructor() {
    super("You've already reviewed this product");
    this.name = "AlreadyReviewedError";
  }
}

export class InvalidReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReviewInputError";
  }
}

export interface CreateReviewInput {
  customerId: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
  photoAssetIds?: string[];
}

export interface CreatedReview {
  id: string;
  status: "PENDING";
  verifiedPurchase: boolean;
}

/**
 * Pure order-item -> verifiedPurchase logic, extracted so it's unit
 * testable without a database: feed it a fake `{ order: { status } }[]`
 * shape. The caller (createReview below) is responsible for only ever
 * passing order items that already belong to this customer and reference
 * one of this product's variants — this function only decides whether any
 * of those rows counts as a real purchase.
 */
export function computeVerifiedPurchase(
  orderItems: { order: { status: OrderStatus } }[],
): boolean {
  return orderItems.some((item) => PURCHASE_COUNTING_ORDER_STATUSES.has(item.order.status));
}

async function computeVerifiedPurchaseForCustomer(
  customerId: string,
  productId: string,
): Promise<boolean> {
  const variants = await db.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });
  if (variants.length === 0) return false;

  const orderItems = await db.orderItem.findMany({
    where: {
      variantId: { in: variants.map((v) => v.id) },
      order: { customerId },
    },
    select: { order: { select: { status: true } } },
  });

  return computeVerifiedPurchase(orderItems);
}

function assertValidRating(rating: number): void {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new InvalidReviewInputError("Rating must be a whole number from 1 to 5");
  }
}

function assertValidTitle(title: string): void {
  const length = title.trim().length;
  if (length < REVIEW_TITLE_MIN || length > REVIEW_TITLE_MAX) {
    throw new InvalidReviewInputError(
      `Title must be between ${REVIEW_TITLE_MIN} and ${REVIEW_TITLE_MAX} characters`,
    );
  }
}

function assertValidBody(body: string): void {
  const length = body.trim().length;
  if (length < REVIEW_BODY_MIN || length > REVIEW_BODY_MAX) {
    throw new InvalidReviewInputError(
      `Review must be between ${REVIEW_BODY_MIN} and ${REVIEW_BODY_MAX} characters`,
    );
  }
}

/**
 * Creates a PENDING review for a customer. Never revalidates any cache tag
 * on create — a PENDING review isn't visible anywhere yet, so there's
 * nothing for a customer-facing page to show sooner. The product's cache
 * tag is revalidated on approval instead (see moderate-review.ts), which is
 * the point a review actually becomes visible.
 */
export async function createReview(input: CreateReviewInput): Promise<CreatedReview> {
  assertValidRating(input.rating);
  assertValidTitle(input.title);
  assertValidBody(input.body);

  if (input.photoAssetIds && input.photoAssetIds.length > REVIEW_MAX_PHOTOS) {
    throw new InvalidReviewInputError(`At most ${REVIEW_MAX_PHOTOS} photos are allowed`);
  }

  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, status: true, slug: true },
  });
  if (!product) throw new ProductNotFoundError();
  if (product.status !== "ACTIVE") throw new ProductNotActiveError();

  const existing = await db.review.findUnique({
    where: { productId_customerId: { productId: input.productId, customerId: input.customerId } },
    select: { id: true },
  });
  if (existing) throw new AlreadyReviewedError();

  const verifiedPurchase = await computeVerifiedPurchaseForCustomer(input.customerId, input.productId);

  try {
    const review = await db.review.create({
      data: {
        productId: input.productId,
        customerId: input.customerId,
        rating: input.rating,
        title: input.title.trim(),
        body: input.body.trim(),
        photoIds: input.photoAssetIds ?? [],
        status: "PENDING",
        verifiedPurchase,
      },
      select: { id: true },
    });

    return { id: review.id, status: "PENDING", verifiedPurchase };
  } catch (error) {
    // Race: two concurrent submissions for the same product+customer both
    // pass the findUnique check above before either commits. The
    // @@unique([productId, customerId]) constraint is the real guard;
    // this just turns its violation into the same typed error as the
    // pre-check above instead of a raw Prisma error leaking out.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AlreadyReviewedError();
    }
    throw error;
  }
}

/** Cache tag to revalidate once a review affecting this product's public
 * rating/reviews changes visibility (approve/reject) — re-exported here so
 * moderate-review.ts doesn't need its own import path back into
 * lib/products just for this one constant. */
export function productReviewsCacheTag(slug: string): string {
  return productCacheTag(slug);
}
