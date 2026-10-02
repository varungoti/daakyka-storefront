import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveContactIntent } from "@/app/contact/contact-intent";

/**
 * F-154: checkout's "Having trouble? Contact us" link and the checkout error
 * page both go to /contact?intent=checkout. That used to read "Checkout is
 * being connected" (checkout is live) and open the form on General Enquiry.
 */
describe("resolveContactIntent", () => {
  it("gives a shopper arriving from checkout help-with-your-order copy that does not say checkout is unfinished", () => {
    const { heading, isCheckoutHelp } = resolveContactIntent({ intent: "checkout" });
    assert.equal(isCheckoutHelp, true);
    assert.equal(heading.title, "Need Help With Your Order?");
    assert.match(heading.description, /what went wrong at checkout/);
    assert.match(heading.description, /call or WhatsApp you back/);
    for (const stale of [/being connected/i, /Complete Your Order/i, /coming soon/i]) {
      assert.doesNotMatch(`${heading.title} ${heading.description}`, stale);
    }
  });

  it("opens the form on Product Support for checkout help", () => {
    assert.equal(resolveContactIntent({ intent: "checkout" }).defaultType, "SUPPORT");
  });

  it("opens on General Enquiry otherwise, with the general heading", () => {
    const plain = resolveContactIntent({});
    assert.equal(plain.defaultType, "GENERAL");
    assert.equal(plain.isCheckoutHelp, false);
    assert.equal(plain.heading.title, "Contact DAAKYKA");
  });

  it("an explicit ?type= wins over the checkout default", () => {
    assert.equal(resolveContactIntent({ intent: "checkout", type: "bulk" }).defaultType, "BULK_ORDER");
    assert.equal(resolveContactIntent({ type: "institutional" }).defaultType, "INSTITUTIONAL");
    assert.equal(resolveContactIntent({ type: "support" }).defaultType, "SUPPORT");
    assert.equal(resolveContactIntent({ type: "general" }).defaultType, "GENERAL");
  });

  it("ignores an unknown ?type=, including names that exist on Object.prototype", () => {
    for (const type of ["nope", "constructor", "toString", "__proto__", "hasOwnProperty", ""]) {
      assert.equal(resolveContactIntent({ type }).defaultType, "GENERAL", type);
      assert.equal(resolveContactIntent({ type, intent: "checkout" }).defaultType, "SUPPORT", `${type} + checkout`);
    }
  });

  it("only ?intent=checkout switches the heading", () => {
    for (const intent of ["Checkout", "cart", "", undefined]) {
      assert.equal(resolveContactIntent({ intent }).isCheckoutHelp, false, String(intent));
    }
  });
});

describe("the links into checkout help", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("checkout's Contact us link and its error page both use ?intent=checkout", () => {
    for (const file of ["src/components/checkout/checkout-page-content.tsx", "src/app/checkout/error.tsx"]) {
      assert.ok(read(file).includes("/contact?intent=checkout"), file);
    }
  });

  it("the contact page takes its heading, preset type and form prompt from the intent", () => {
    const source = read("src/app/contact/page.tsx");
    assert.match(source, /resolveContactIntent\(params\)/);
    assert.match(source, /title=\{heading\.title\}/);
    assert.match(source, /<ContactForm defaultType=\{defaultType\} checkoutHelp=\{isCheckoutHelp\} \/>/);
    assert.match(source, /titleAs="h1"/, "the page has exactly one h1");
  });
});
