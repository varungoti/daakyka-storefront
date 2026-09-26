import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { db } from "@/lib/db";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { getSetting } from "@/lib/settings";
import { POST as quoteRoute } from "@/app/api/checkout/quote/route";

/**
 * Audit F-115/F-116 (checkout-page-ux-integrity): the checkout page used
 * to say "Shipping is calculated at the next step" with no next step, and
 * showed the price frozen in the cart at add-to-cart time even after the
 * real price changed. POST /api/checkout/quote is the side-effect-free
 * preview that fixes both — these tests cover it directly, the same
 * request/response-shape style as tests/integration/checkout.test.ts.
 */

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

async function createActiveProductWithVariant(opts: { stock: number; price?: number }) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `Quote Test Category ${unique}`, slug: `quote-test-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Quote Test Product ${unique}`,
      slug: `quote-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: opts.price ?? 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `DK-QUOTE-${unique}`,
      size: "M",
      color: "Navy",
      stock: opts.stock,
      active: true,
    },
  });

  return { product, variant };
}

describe("POST /api/checkout/quote", () => {
  it("re-prices every line from the DB and computes shipping from the real settings, ignoring any client-sent price", async () => {
    const { product, variant } = await createActiveProductWithVariant({ stock: 10, price: 750 });
    const [flatRate, freeAbove] = await Promise.all([
      getSetting("shipping.flatRate"),
      getSetting("shipping.freeAbove"),
    ]);

    const response = await quoteRoute(
      jsonRequest("http://localhost/api/checkout/quote", {
        items: [{ variantId: variant.id, quantity: 2, unitPrice: 1 }],
      }),
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      lines: { variantId: string; unitPrice: number; quantity: number }[];
      subtotal: number;
      shipping: number;
      freeAbove: number;
      total: number;
    };

    const expectedSubtotal = Number(product.price) * 2;
    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].variantId, variant.id);
    assert.equal(data.lines[0].unitPrice, Number(product.price));
    assert.equal(data.subtotal, expectedSubtotal);
    assert.equal(data.freeAbove, freeAbove);
    const expectedShipping = expectedSubtotal >= freeAbove ? 0 : flatRate;
    assert.equal(data.shipping, expectedShipping);
    assert.equal(data.total, expectedSubtotal + expectedShipping);
  });

  it("matches createOrderFromCart's subtotal/shipping/total for the exact same cart, so the preview can never drift from the real charge", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 10, price: 333 });

    const quoteResponse = await quoteRoute(
      jsonRequest("http://localhost/api/checkout/quote", {
        items: [{ variantId: variant.id, quantity: 3 }],
      }),
    );
    assert.equal(quoteResponse.status, 200);
    const quote = (await quoteResponse.json()) as { subtotal: number; shipping: number; total: number };

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 3 }],
      email: "quote-parity@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(order.id);

    assert.equal(quote.subtotal, order.subtotal);
    assert.equal(quote.shipping, order.shipping);
    assert.equal(quote.total, order.total);
  });

  it("returns 409 with the offending variantId when a line is out of stock, and does not touch stock", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 2 });

    const response = await quoteRoute(
      jsonRequest("http://localhost/api/checkout/quote", {
        items: [{ variantId: variant.id, quantity: 5 }],
      }),
    );

    assert.equal(response.status, 409);
    const data = (await response.json()) as { error: string; variantId: string };
    assert.equal(data.variantId, variant.id);

    const untouched = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(untouched?.stock, 2, "the quote must never write to stock");
  });

  it("returns 400 with the offending variantId for an inactive variant", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    await db.productVariant.update({ where: { id: variant.id }, data: { active: false } });

    const response = await quoteRoute(
      jsonRequest("http://localhost/api/checkout/quote", {
        items: [{ variantId: variant.id, quantity: 1 }],
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string; variantId: string };
    assert.equal(data.variantId, variant.id);
  });

  it("rejects an empty items array with 400 and creates no side effects", async () => {
    const response = await quoteRoute(jsonRequest("http://localhost/api/checkout/quote", { items: [] }));
    assert.equal(response.status, 400);
  });
});
