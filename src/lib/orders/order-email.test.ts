import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatEmailMoney, renderEmailLayout, type EmailFooter } from "@/lib/email/layout";
import {
  formatAddressLines,
  renderAdminOrderEmail,
  renderCustomerOrderEmail,
  renderOrderStatusEmail,
  renderOrderSummary,
  type OrderEmailData,
} from "@/lib/orders/order-email";

/**
 * F-041: the transactional order emails are a real, branded summary — items,
 * address, ₹ totals with Indian digit grouping, a store footer and a
 * plain-text part that spells out every URL. Pure rendering, no DB.
 */

const footer: EmailFooter = {
  storeName: "DAAKYKA Apparels",
  legalName: "Babaji Enterprises",
  address: "286 Ridgewood Residency, Road No. 6, Kavuri Hills, Hyderabad",
  phone: "+91 95530 94251",
  email: "care@example.test",
  gstin: "",
};

const order: OrderEmailData = {
  number: "DK-2026-0000000001",
  email: "buyer@example.com",
  phone: "9876543210",
  currency: "INR",
  paymentMethod: "RAZORPAY",
  items: [
    { name: "Scrub Top <Navy> & Co", variantLabel: "M / Navy", quantity: 2, unitPrice: 599 },
    { name: "Scrub Pant", variantLabel: null, quantity: 1, unitPrice: 1200.5 },
  ],
  subtotal: 2398.5,
  shipping: 0,
  discount: 100,
  discountCode: "WELCOME100",
  total: 2298.5,
  addressLines: ["Priya <Sharma>", "1 Test Street", "Hyderabad, Telangana 500032", "India"],
};

describe("formatEmailMoney", () => {
  it("uses the rupee symbol with Indian grouping and always shows paise", () => {
    assert.equal(formatEmailMoney(1198), "₹1,198.00");
    assert.equal(formatEmailMoney(123456.5), "₹1,23,456.50");
  });

  it("never prints the 'INR 1198.00' form", () => {
    assert.ok(!formatEmailMoney(1198, "INR").includes("INR"));
  });

  it("falls back to the ISO code for a non-INR currency instead of guessing a symbol", () => {
    assert.equal(formatEmailMoney(12.5, "usd"), "USD 12.50");
  });
});

describe("renderEmailLayout", () => {
  it("wraps the body in a branded shell with a store footer, and builds a text part", () => {
    const { html, text } = renderEmailLayout({
      subject: "Hello",
      heading: "Hi there",
      bodyHtml: `<p>Body <a href="https://shop.test/x">link</a></p>`,
      footer,
    });
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("DAAKYKA Apparels"));
    assert.ok(html.includes("Kavuri Hills"));
    assert.ok(html.includes("+91 95530 94251"));
    assert.ok(html.includes("Babaji Enterprises"));
    assert.ok(text.includes("link (https://shop.test/x)"), "the derived text part keeps the link");
    assert.ok(text.includes("Babaji Enterprises"));
  });

  it("omits the GSTIN line until the owner has entered one, then shows it", () => {
    const without = renderEmailLayout({ subject: "s", bodyHtml: "<p>x</p>", footer });
    assert.ok(!without.html.includes("GSTIN"));
    assert.ok(!without.text.includes("GSTIN"));
    const withGstin = renderEmailLayout({ subject: "s", bodyHtml: "<p>x</p>", footer: { ...footer, gstin: "36ABCDE1234F1Z5" } });
    assert.ok(withGstin.html.includes("GSTIN 36ABCDE1234F1Z5"));
    assert.ok(withGstin.text.includes("GSTIN 36ABCDE1234F1Z5"));
  });

  it("escapes footer values that came from admin-editable settings", () => {
    const { html } = renderEmailLayout({ subject: "s", bodyHtml: "<p>x</p>", footer: { ...footer, address: "<b>Evil</b> Road" } });
    assert.ok(!html.includes("<b>Evil</b>"));
    assert.ok(html.includes("&lt;b&gt;Evil&lt;/b&gt; Road"));
  });
});

describe("formatAddressLines", () => {
  it("builds name, street, city/state/pincode and country lines", () => {
    assert.deepEqual(
      formatAddressLines({ name: "Priya", line1: "1 Test Street", line2: "", city: "Hyderabad", state: "Telangana", pincode: "500032", country: "IN" }),
      ["Priya", "1 Test Street", "Hyderabad, Telangana 500032", "India"],
    );
  });

  it("returns no lines (never throws) for a missing or malformed address", () => {
    assert.deepEqual(formatAddressLines(null), []);
    assert.deepEqual(formatAddressLines("nope"), []);
    assert.deepEqual(formatAddressLines({}), []);
  });
});

describe("renderOrderSummary", () => {
  it("lists items, totals in ₹ and the address, escaping everything typed by a shopper or admin", () => {
    const { html, text } = renderOrderSummary(order);
    assert.ok(html.includes("Scrub Top &lt;Navy&gt; &amp; Co"));
    assert.ok(!html.includes("<Navy>"));
    assert.ok(html.includes("₹1,198.00"), "line total for 2 x 599");
    assert.ok(html.includes("₹2,298.50"), "grand total");
    assert.ok(html.includes("Free"), "free shipping reads Free, not ₹0.00");
    assert.ok(html.includes("WELCOME100"));
    assert.ok(html.includes("Priya &lt;Sharma&gt;"));
    assert.ok(html.includes("Phone: 9876543210"));

    assert.ok(text.includes("- Scrub Top <Navy> & Co (M / Navy) x 2 - ₹1,198.00"));
    assert.ok(text.includes("Total: ₹2,298.50"));
    assert.ok(text.includes("Discount (WELCOME100): -₹100.00"));
    assert.ok(text.includes("Shipping to:"));
  });

  it("omits the discount row and the address block when there is neither", () => {
    const { html, text } = renderOrderSummary({ ...order, discount: 0, discountCode: null, addressLines: [] });
    assert.ok(!html.includes("Discount"));
    assert.ok(!text.includes("Discount"));
    assert.ok(!html.includes("Shipping to"));
  });
});

describe("renderCustomerOrderEmail", () => {
  const base = {
    orderNumber: order.number,
    total: order.total,
    currency: "INR",
    fallback: false,
    stockConflict: false,
    orderLink: "https://shop.test/order/DK-2026-0000000001?sig=abc",
    order,
    footer,
  };

  it("confirms payment with the summary, an order link in both parts, and the tax-inclusive note", () => {
    const email = renderCustomerOrderEmail(base);
    assert.equal(email.subject, `Payment received — order ${order.number}`);
    assert.ok(email.html.includes("₹2,298.50"));
    assert.ok(email.html.includes(`href="https://shop.test/order/DK-2026-0000000001?sig=abc"`));
    assert.ok(email.text.includes("View your order: https://shop.test/order/DK-2026-0000000001?sig=abc"));
    assert.ok(email.text.includes("Prices are inclusive of all taxes."));
    assert.ok(email.text.includes("We'll let you know as soon as it ships."));
  });

  it("never promises shipping when a line lost the stock race (F-283)", () => {
    const email = renderCustomerOrderEmail({ ...base, stockConflict: true });
    assert.ok(email.subject.includes("stock issue"));
    assert.ok(!email.text.includes("as soon as it ships"));
    assert.ok(!email.html.includes("as soon as it ships"));
    assert.ok(email.text.includes("refund"));
  });

  it("uses the order-request wording when no online payment was taken", () => {
    const email = renderCustomerOrderEmail({ ...base, fallback: true });
    assert.equal(email.subject, `We received your order ${order.number}`);
    assert.ok(email.text.includes("Our team will contact you shortly to confirm payment and delivery."));
  });

  it("still renders a complete email when the order could not be loaded (best-effort)", () => {
    const email = renderCustomerOrderEmail({ ...base, order: null });
    assert.ok(email.html.includes("₹2,298.50"), "the amount in the lead sentence survives");
    assert.ok(email.text.includes("View your order:"));
  });
});

describe("renderAdminOrderEmail", () => {
  it("links straight to the order in the admin, in both parts", () => {
    const email = renderAdminOrderEmail({
      orderId: "ord_123",
      orderNumber: order.number,
      customerEmail: "buyer@example.com",
      total: order.total,
      currency: "INR",
      fallback: false,
      order,
      footer,
    });
    assert.ok(email.html.includes("/admin/orders/ord_123"));
    assert.ok(email.text.includes("/admin/orders/ord_123"));
    assert.ok(email.html.includes("Scrub Pant"), "carries the item summary");
    assert.equal(email.subject, `New order ${order.number} (paid)`);
  });
});

describe("renderOrderStatusEmail", () => {
  it("escapes admin-typed tracking details and puts the tracking link in the text part", () => {
    const email = renderOrderStatusEmail({
      orderNumber: order.number,
      toStatus: "SHIPPED",
      trackingNumber: "<b>TRK1</b>",
      courier: "Bluedart",
      paymentMethod: "RAZORPAY",
      hasCapturedPayment: true,
      footer,
    });
    assert.ok(!email.html.includes("<b>TRK1</b>"));
    assert.ok(email.html.includes("&lt;b&gt;TRK1&lt;/b&gt;"));
    assert.ok(email.text.includes("Tracking number via Bluedart: <b>TRK1</b>"));
  });

  it("uses the 'no charge was made' wording only for a RAZORPAY order that never captured a payment", () => {
    const neverPaid = renderOrderStatusEmail({
      orderNumber: order.number,
      toStatus: "CANCELLED",
      paymentMethod: "RAZORPAY",
      hasCapturedPayment: false,
      footer,
    });
    assert.ok(neverPaid.text.includes("no charge was made"));
    const paid = renderOrderStatusEmail({
      orderNumber: order.number,
      toStatus: "CANCELLED",
      paymentMethod: "RAZORPAY",
      hasCapturedPayment: true,
      footer,
    });
    assert.ok(!paid.text.includes("no charge was made"));
    assert.ok(paid.text.includes("any eligible refund"));
  });

  it("renders a refunded email", () => {
    const email = renderOrderStatusEmail({
      orderNumber: order.number,
      toStatus: "REFUNDED",
      paymentMethod: "RAZORPAY",
      hasCapturedPayment: true,
      footer,
    });
    assert.equal(email.subject, `Your order ${order.number} was refunded`);
    assert.ok(email.text.includes("Babaji Enterprises"));
  });
});
