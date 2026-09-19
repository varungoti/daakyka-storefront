import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { listOrdersForCustomer } from "@/lib/orders/customer-orders";

/**
 * Release-hardening item 2 (Medium parity gap — see
 * docs/audit-2026-09-19/storefront-ux.md's "Order tracking page" row):
 * covers listOrdersForCustomer (src/lib/orders/customer-orders.ts), the
 * data layer behind /account/orders. Scoping to a single customerId is
 * the security-relevant property here (mirrors order-access.test.ts's
 * coverage of getAuthorizedOrder, the sibling function the per-order
 * detail page at /account/orders/[number] uses) — this file adds the
 * list-level equivalent: one customer must never see another's orders.
 */

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdCustomerIds: string[] = [];

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
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
});

const SHIPPING_ADDRESS = {
  name: "Buyer",
  line1: "1 Test Street",
  city: "Hyderabad",
  state: "Telangana",
  pincode: "500032",
  country: "IN",
};

async function createActiveProductWithVariant(stock: number) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: {
      name: `Customer Orders Test Category ${unique}`,
      slug: `customer-orders-test-category-${unique}`,
      section: "GENERAL",
    },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Customer Orders Test Product ${unique}`,
      slug: `customer-orders-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `DK-CUSTORDERS-${unique}`,
      size: "M",
      color: "Navy",
      stock,
      active: true,
    },
  });

  return variant;
}

async function createOrderForCustomer(customerId: string) {
  const variant = await createActiveProductWithVariant(5);
  const order = await createOrderFromCart({
    items: [{ variantId: variant.id, quantity: 1 }],
    email: `buyer-${randomUUID().slice(0, 8)}@example.com`,
    shippingAddress: SHIPPING_ADDRESS,
    customerId,
    paymentMethod: "ORDER_REQUEST",
  });
  createdOrderIds.push(order.id);
  return order;
}

async function createCustomer() {
  const unique = randomUUID().slice(0, 8);
  const customer = await db.customer.create({
    data: { email: `customer-orders-${unique}@example.com`, name: "Test Customer", passwordHash: "x" },
  });
  createdCustomerIds.push(customer.id);
  return customer;
}

describe("listOrdersForCustomer (release-hardening item 2)", () => {
  it("returns an empty page for a customer with no orders, rather than erroring", async () => {
    const customer = await createCustomer();
    const result = await listOrdersForCustomer(customer.id);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
    assert.equal(result.page, 1);
    assert.equal(result.totalPages, 1);
  });

  it("only returns orders belonging to the requested customer, never another customer's", async () => {
    const customerA = await createCustomer();
    const customerB = await createCustomer();

    const orderA = await createOrderForCustomer(customerA.id);
    await createOrderForCustomer(customerB.id);
    await createOrderForCustomer(customerB.id);

    const resultA = await listOrdersForCustomer(customerA.id);
    assert.equal(resultA.total, 1);
    assert.equal(resultA.items.length, 1);
    assert.equal(resultA.items[0].id, orderA.id);

    const resultB = await listOrdersForCustomer(customerB.id);
    assert.equal(resultB.total, 2);
    assert.ok(resultB.items.every((item) => item.id !== orderA.id), "customer B's list must never include customer A's order");
  });

  it("never returns a guest (customerId-less) order for any customer", async () => {
    const customer = await createCustomer();
    await createOrderForCustomer(customer.id);
    // A guest order (no customerId) for the same product/shape.
    const variant = await createActiveProductWithVariant(5);
    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: `guest-${randomUUID().slice(0, 8)}@example.com`,
      shippingAddress: SHIPPING_ADDRESS,
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);

    const result = await listOrdersForCustomer(customer.id);
    assert.ok(result.items.every((item) => item.id !== guestOrder.id));
  });

  it("orders by most recent first and reports item counts/totals", async () => {
    const customer = await createCustomer();
    const first = await createOrderForCustomer(customer.id);
    const second = await createOrderForCustomer(customer.id);

    const result = await listOrdersForCustomer(customer.id);
    assert.equal(result.items[0].id, second.id, "most recently created order should be first");
    assert.equal(result.items[1].id, first.id);
    for (const item of result.items) {
      assert.equal(item.itemCount, 1);
      assert.ok(item.total > 0);
    }
  });

  it("paginates: pageSize is honored and totalPages/page reflect the requested page", async () => {
    const customer = await createCustomer();
    for (let i = 0; i < 5; i++) {
      await createOrderForCustomer(customer.id);
    }

    const pageOne = await listOrdersForCustomer(customer.id, { page: 1, pageSize: 2 });
    assert.equal(pageOne.items.length, 2);
    assert.equal(pageOne.total, 5);
    assert.equal(pageOne.totalPages, 3);
    assert.equal(pageOne.page, 1);

    const pageTwo = await listOrdersForCustomer(customer.id, { page: 2, pageSize: 2 });
    assert.equal(pageTwo.items.length, 2);
    assert.notDeepEqual(pageTwo.items[0].id, pageOne.items[0].id);

    const pageThree = await listOrdersForCustomer(customer.id, { page: 3, pageSize: 2 });
    assert.equal(pageThree.items.length, 1);
  });

  it("clamps an out-of-range page to the last valid page instead of returning an empty result", async () => {
    const customer = await createCustomer();
    await createOrderForCustomer(customer.id);

    const result = await listOrdersForCustomer(customer.id, { page: 999, pageSize: 10 });
    assert.equal(result.page, 1);
    assert.equal(result.items.length, 1);
  });
});
