import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BespokeSection } from "@/components/home/bespoke-section";
import { BulkOrdersSection } from "@/components/home/bulk-orders-section";
import { PolicyPage } from "@/components/legal/policy-page";
import { ShopFeatureCards } from "@/components/shop/shop-feature-cards";
import { FocusedStatus } from "@/components/ui/focused-status";
import { SectionHeading } from "@/components/ui/section-heading";
import CollectionsPage from "@/app/collections/page";

/**
 * release-hardening a11y sweep 1 (F-047, F-088, F-022, F-056, F-241): the
 * markup contracts that axe's `page-has-heading-one`, the missing
 * `<a><button>` nested-interactive check (axe doesn't flag it, which is how
 * it slipped through) and `link-in-text-block` rely on. These components are
 * all provider-free server components, so they render without a DOM.
 */
/** createElement with children passed positionally, for components whose props type requires `children`. */
const h = createElement as unknown as (
  type: unknown,
  props: Record<string, unknown>,
  ...children: unknown[]
) => ReactElement;
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
/** The opening tag of the first <a> whose href is exactly `href` (attribute order varies). */
const anchorTag = (html: string, href: string) =>
  html.split("<a ").map((chunk) => chunk.slice(0, chunk.indexOf(">") + 1)).find((tag) => tag.includes(`href="${href}"`)) ??
  "";

describe("page <h1>s (F-047)", () => {
  it("SectionHeading defaults to an h2 and renders an h1 only when asked", () => {
    assert.equal(count(renderToStaticMarkup(createElement(SectionHeading, { title: "T" })), /<h1/g), 0);
    const html = renderToStaticMarkup(createElement(SectionHeading, { title: "T", titleAs: "h1" }));
    assert.equal(count(html, /<h1/g), 1);
    assert.equal(count(html, /<h2/g), 0);
  });

  it("every policy page (terms, returns, shipping, privacy, accessibility) gets exactly one h1 from PolicyPage", () => {
    const html = renderToStaticMarkup(
      h(PolicyPage, { title: "Shipping & Delivery", description: "d" }, createElement("p", null, "body")),
    );
    assert.equal(count(html, /<h1/g), 1);
    assert.match(html, /<h1[^>]*>Shipping &amp; Delivery<\/h1>/);
  });

  it("/collections renders one h1", () => {
    const html = renderToStaticMarkup(createElement(CollectionsPage));
    assert.equal(count(html, /<h1/g), 1);
  });

  it("BespokeSection keeps its h2 by default (homepage, /our-story) and is an h1 only on /shop/bespoke", () => {
    const asDefault = renderToStaticMarkup(createElement(BespokeSection));
    assert.equal(count(asDefault, /<h1/g), 0);
    assert.match(asDefault, /<h2[^>]*>Made to Order for Your Team<\/h2>/);

    const asHero = renderToStaticMarkup(createElement(BespokeSection, { headingAs: "h1" }));
    assert.equal(count(asHero, /<h1/g), 1);
    assert.equal(count(asHero, /<h2/g), 0);
  });
});

describe("CTAs are a single interactive element (F-088, F-022)", () => {
  // `<a ...><button` — interactive content inside a link (invalid HTML, two
  // tab stops per CTA).
  const nested = /<a\b[^>]*>\s*<button/;

  it("the homepage bulk-orders band renders its CTAs as styled links", () => {
    const html = renderToStaticMarkup(createElement(BulkOrdersSection));
    assert.ok(!nested.test(html));
    assert.ok(!html.includes("<button"));
    assert.match(anchorTag(html, "/bulk-orders"), /class="[^"]*bg-brand[^"]*"/);
  });

  it("the /shop feature cards render their CTA as a styled link", () => {
    const html = renderToStaticMarkup(createElement(ShopFeatureCards, {}));
    assert.ok(!nested.test(html));
    assert.ok(!html.includes("<button"));
    assert.match(anchorTag(html, "/shop/bespoke"), /class="[^"]*mt-6[^"]*"/);
  });

  it("no component wraps <Button> in a <Link>/<a> any more", () => {
    // Source-level guard: axe doesn't catch this, so a regression would only
    // show up as a double tab stop. Anything that needs a button-styled link
    // must use buttonClassNames() on the <Link> itself.
    const files = [
      "src/components/category/section-landing-page.tsx",
      "src/components/checkout/checkout-page-content.tsx",
      "src/components/home/bulk-orders-section.tsx",
      "src/components/home/section-feature-band.tsx",
      "src/components/shop/shop-feature-cards.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.ok(!/<Link\b[^>]*>\s*<Button\b/.test(source), `${file} nests <Button> inside <Link>`);
    }
  });
});

describe("FocusedStatus (F-241)", () => {
  it("is a live status region that can take programmatic focus but isn't a tab stop", () => {
    const html = renderToStaticMarkup(h(FocusedStatus, { className: "x" }, "Message Sent"));
    assert.match(html, /role="status"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /Message Sent/);
  });
});

describe("policy-page inline links (F-056)", () => {
  it("PolicyPage's prose container carries the .prose-policy hook the stylesheet underlines", () => {
    const html = renderToStaticMarkup(
      h(PolicyPage, { title: "t", description: "d" }, createElement("p", null, "x")),
    );
    assert.match(html, /class="prose-policy[^"]*"/);
  });

  it("globals.css underlines links inside .prose-policy (colour alone is ~1.3:1 from the body text)", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/\.prose-policy a\s*\{([^}]*)\}/);
    assert.ok(rule, "expected a `.prose-policy a` rule");
    assert.match(rule[1], /text-decoration-line:\s*underline/);
  });
});

describe("focus indicators and tab stops (F-239, F-083 review follow-ups)", () => {
  it("the product-card link keeps an outline that forced-colors mode can paint", () => {
    // Forced-colors mode (Windows High Contrast) strips box-shadow, so the
    // card's ring is invisible there. `outline-none` on the link would leave
    // no focus indicator at all; the inset transparent outline is repainted
    // in a system colour instead.
    const source = readFileSync("src/components/ui/product-card.tsx", "utf8");
    const link = source.slice(source.indexOf(`data-card-link=""`));
    assert.ok(!/focus-visible:outline-none/.test(link), "the name/price link must not drop its outline");
    for (const utility of [
      "focus-visible:outline-2!",
      "focus-visible:-outline-offset-2!",
      "focus-visible:outline-transparent!",
    ]) {
      assert.ok(link.includes(utility), `expected ${utility} on the name/price link`);
    }
    // ...and the ring that shows in normal mode is still on the card.
    assert.match(source, /has-\[\[data-card-link\]:focus-visible\]:ring-2/);
  });

  it("the search dialog always renders a Tab-focusable link inside its scrolling suggestions region", () => {
    // The options are tabIndex -1 (arrow keys move through them), so without
    // a link in the scroll region axe's scrollable-region-focusable fires
    // for the freshly opened, empty-query dialog.
    const source = readFileSync("src/components/search/search-dialog.tsx", "utf8");
    const region = source.slice(source.indexOf("max-h-[420px] overflow-y-auto"));
    assert.ok(region.includes("Browse all products"), "empty query needs a 'Browse all products' link");
    assert.match(region, /href="\/shop"/);
    assert.ok(region.includes("Search all products for"), "typed query keeps its 'Search all products' link");
    // The fallback link must not be gated on a query being typed.
    assert.ok(!/\{!loading && query\.trim\(\) && \(/.test(region));
  });
});
