import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { OrderTimelineView } from "@/components/account/order-timeline";
import { BulkLeadStatusSelect } from "@/components/admin/bulk-lead-status-select";
import { CampaignStatusSelect } from "@/components/admin/campaign-status-select";
import { ContactEnquiryStatusSelect } from "@/components/admin/contact-enquiry-status-select";
import { CustomersTable } from "@/components/admin/customers-table";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes";
import { HermesApprovalActions } from "@/components/admin/hermes-approval-actions";
import { HermesTaskLauncher } from "@/components/admin/hermes-task-launcher";
import { HeroSlidesEditor } from "@/components/admin/hero-slides-editor";
import { HomepageEditor } from "@/components/admin/homepage-editor";
import { JourneyStatusSelect } from "@/components/admin/journey-status-select";
import { OrderDetailActions } from "@/components/admin/order-detail-actions";
import { OrdersTable } from "@/components/admin/orders-table";
import { ProductVariantEditor } from "@/components/admin/product-variant-editor";
import { ProductsTable } from "@/components/admin/products-table";
import { SizeChartForm } from "@/components/admin/size-chart-form";
import { UserRoleEditor } from "@/components/admin/user-role-editor";
import { SeoLandingLayout } from "@/components/seo/seo-landing-layout";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { WishlistProvider } from "@/context/wishlist-provider";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { countedLabel, quickAddLabel, wishlistToggleLabel } from "@/lib/a11y/labels";
import { getOrderTimeline, type OrderTimeline } from "@/lib/orders/timeline";
import type { Product } from "@/lib/types";
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

/**
 * release-hardening a11y sweep 2 (F-245..F-248, F-066, F-220). Markup and
 * source contracts for the storefront semantics, and a "no unnamed control"
 * pass over the admin screens that axe flagged (select-name / label). The
 * admin pieces render without a DOM, so only what is in the first server
 * render is covered here — rows that arrive from a fetch are checked at the
 * source level where it matters.
 */
describe("accessible names that carry context (F-248)", () => {
  it("countedLabel folds the badge count into the name, singular and plural", () => {
    assert.equal(countedLabel("Cart", 2), "Cart, 2 items");
    assert.equal(countedLabel("Wishlist", 1), "Wishlist, 1 item");
  });

  it("countedLabel leaves the plain name alone when there is no count", () => {
    assert.equal(countedLabel("Cart", 0), "Cart");
    assert.equal(countedLabel("Cart", undefined), "Cart");
  });

  it("every label still begins with the control's visible text (WCAG 2.5.3 Label in Name)", () => {
    assert.ok(countedLabel("Cart", 3).startsWith("Cart"));
    assert.ok(wishlistToggleLabel("Kids Hoodie", false).startsWith("Add"));
    assert.ok(wishlistToggleLabel("Kids Hoodie", true).startsWith("Remove"));
    assert.ok(quickAddLabel("Kids Hoodie", "M", "idle").startsWith("Quick Add"));
    assert.ok(quickAddLabel("Kids Hoodie", "M", "added").startsWith("Added"));
    assert.ok(quickAddLabel("Kids Hoodie", "M", "soldOut").startsWith("Sold out"));
  });

  it("the wishlist heart names its product and keeps aria-pressed", () => {
    const product = { id: "p1", name: "Kids Hoodie" } as Product;
    const html = renderToStaticMarkup(h(WishlistProvider, {}, createElement(WishlistButton, { product })));
    assert.match(html, /aria-label="Add Kids Hoodie to wishlist"/);
    assert.match(html, /aria-pressed="false"/);
  });

  it("the header's Cart and Wishlist buttons pass their badge through countedLabel", () => {
    const source = readFileSync("src/components/layout/header.tsx", "utf8");
    assert.match(source, /countedLabel\(label, badge\)/);
    assert.ok(!/aria-label=\{label\}/.test(source), "a bare aria-label={label} would drop the count again");
  });

  it("the Quick Add panel names its size group and its button after the product", () => {
    const source = readFileSync("src/components/ui/product-card.tsx", "utf8");
    assert.match(source, /role="group" aria-label=\{`Size for \$\{product\.name\}`\}/);
    assert.match(source, /aria-label=\{quickAddLabel\(product\.name, size,/);
  });

  it("the order timeline marks the current step and says which steps are done", () => {
    const timeline = {
      steps: [
        { id: "placed", label: "Order placed", state: "complete" },
        { id: "confirmed", label: "Payment confirmed", state: "current" },
        { id: "shipped", label: "Shipped", state: "upcoming" },
        { id: "delivered", label: "Delivered", state: "upcoming" },
      ],
      terminal: null,
    } as OrderTimeline;
    const html = renderToStaticMarkup(createElement(OrderTimelineView, { timeline }));
    assert.equal(count(html, /aria-current="step"/g), 1);
    assert.match(html, /<li aria-current="step"(?:(?!<\/li>)[\s\S])*Payment confirmed<span class="sr-only"> \(current step\)<\/span>/);
    assert.match(html, /Order placed<span class="sr-only"> \(completed\)<\/span>/);
    // Upcoming steps stay plain: no state text, no aria-current.
    assert.ok(!/Shipped<span class="sr-only">/.test(html));
    assert.ok(!/Delivered<span class="sr-only">/.test(html));
  });

  it("the real timeline for a shipped order marks exactly one current step", () => {
    const html = renderToStaticMarkup(createElement(OrderTimelineView, { timeline: getOrderTimeline("SHIPPED", "RAZORPAY") }));
    assert.equal(count(html, /aria-current="step"/g), 1);
  });

  it("every breadcrumb is a labelled nav whose last crumb is aria-current=page", () => {
    for (const file of [
      "src/components/shop/shop-page-content.tsx",
      "src/app/products/[handle]/page.tsx",
      "src/components/seo/seo-landing-layout.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /<nav aria-label="Breadcrumb"/, `${file}: breadcrumb <nav> needs a name`);
      assert.match(source, /aria-current="page"/, `${file}: the last crumb needs aria-current`);
    }
  });

  it("the SEO guide layout renders its breadcrumb as a labelled landmark", () => {
    const page = seoLandingPages[0];
    const html = renderToStaticMarkup(createElement(SeoLandingLayout, { page }));
    assert.match(html, /<nav aria-label="Breadcrumb"/);
    assert.equal(count(html, /aria-current="page"/g), 1);
  });
});

describe("motion, focus rings and sticky-header offsets (F-245, F-246, F-247)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("the storefront shell wraps everything in MotionConfig reducedMotion=user so the drawers stop sliding", () => {
    const source = readFileSync("src/components/layout/site-shell.tsx", "utf8");
    assert.match(source, /import \{ MotionConfig \} from "framer-motion"/);
    assert.match(source, /<MotionConfig reducedMotion="user">/);
    // The search dialog (in <Header>), the shop's filter drawer (in
    // `children`) and both drawers must all sit inside that provider.
    const inside = source.slice(source.indexOf("<MotionConfig"), source.indexOf("</MotionConfig>"));
    for (const part of ["<Header", "{children}", "<CartDrawer", "<WishlistDrawer"]) {
      assert.ok(inside.includes(part), `${part} must render inside MotionConfig`);
    }
  });

  it("every motion drawer/dialog comes from framer-motion (the package MotionConfig governs)", () => {
    for (const file of [
      "src/components/cart/cart-drawer.tsx",
      "src/components/wishlist/wishlist-drawer.tsx",
      "src/components/shop/mobile-filter-drawer.tsx",
      "src/components/search/search-dialog.tsx",
    ]) {
      assert.match(readFileSync(file, "utf8"), /from "framer-motion"/, file);
    }
  });

  it("globals.css gives the focus ring a white override on the violet utility bar and other dark surfaces", () => {
    const rule = css.match(/\.bg-brand-violet :focus-visible,([^{]*)\{([^}]*)\}/);
    assert.ok(rule, "expected the dark-surface :focus-visible rule");
    assert.match(rule[1], /\.bg-plum :focus-visible/);
    assert.match(rule[1], /\.bg-ink\\\/95 :focus-visible/);
    assert.match(rule[2], /outline-color:\s*#fff/);
  });

  it("the utility bar really is the .bg-brand-violet surface that rule targets", () => {
    assert.match(readFileSync("src/components/layout/announcement-bar.tsx", "utf8"), /"bg-brand-violet /);
  });

  it("globals.css reserves room under the sticky header, taller from lg where the nav row appears", () => {
    assert.match(css, /html \{[^}]*scroll-padding-top:\s*5\.5rem/);
    assert.match(css, /@media \(min-width: 1024px\) \{\s*html \{\s*scroll-padding-top:\s*7\.5rem/);
  });

  it("the mobile sticky add-to-cart bar flags itself so the bottom padding applies only while it shows", () => {
    assert.match(css, /html\[data-sticky-cta\] \{\s*scroll-padding-bottom:/);
    assert.match(
      readFileSync("src/components/product/mobile-sticky-add-to-cart.tsx", "utf8"),
      /setAttribute\("data-sticky-cta", ""\)/,
    );
  });

  it("no per-section scroll-mt-24 is left to stack on top of the global scroll-padding", () => {
    for (const file of ["src/components/product/product-detail.tsx", "src/components/checkout/checkout-page-content.tsx"]) {
      assert.ok(!readFileSync(file, "utf8").includes("scroll-mt-24"), file);
    }
  });
});

// --- admin: every control in the first render has an accessible name ---------

/** A router that does nothing — the status selects call useRouter() at render
 * time, and ProductsTable reads the URL through useSearchParams(). */
const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};
const withRouter = (child: ReactElement) =>
  h(
    AppRouterContext.Provider,
    { value: router },
    h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(UnsavedChangesProvider, {}, child)),
  );
const renderAdmin = (child: ReactElement) => renderToStaticMarkup(withRouter(child));

/**
 * The form controls in `html` that axe's `label` / `select-name` rules would
 * flag: no aria-label, no aria-labelledby, no `<label for>` pointing at their
 * id, and not nested in a `<label>`.
 */
function unnamedControls(html: string): string[] {
  const tags = html.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
  const labelFor = new Set<string>();
  for (const tag of tags) {
    const target = /^<label\b[^>]*\bfor="([^"]*)"/.exec(tag);
    if (target) labelFor.add(target[1]);
  }
  const unnamed: string[] = [];
  let labelDepth = 0;
  for (const tag of tags) {
    if (/^<label\b/.test(tag)) labelDepth += 1;
    else if (tag === "</label>") labelDepth -= 1;
    else if (/^<(input|select|textarea)\b/.test(tag)) {
      if (/\btype="(hidden|submit|button)"/.test(tag)) continue;
      const id = /\bid="([^"]*)"/.exec(tag)?.[1];
      const named =
        /\baria-label="[^"]+"/.test(tag) ||
        /\baria-labelledby="[^"]+"/.test(tag) ||
        (id !== undefined && labelFor.has(id)) ||
        labelDepth > 0;
      if (!named) unnamed.push(tag);
    }
  }
  return unnamed;
}

describe("admin controls have accessible names (F-066, F-220)", () => {
  it("the checker itself flags a bare select and accepts the labelled forms", () => {
    assert.equal(unnamedControls(`<select><option>a</option></select>`).length, 1);
    assert.equal(unnamedControls(`<select aria-label="Sort"></select>`).length, 0);
    assert.equal(unnamedControls(`<label for="x">X</label><input id="x"/>`).length, 0);
    assert.equal(unnamedControls(`<label>X <input/></label>`).length, 0);
    assert.equal(unnamedControls(`<label for="y">Y</label><input id="x"/>`).length, 1);
  });

  it("the orders, products and customers lists name every search box and filter/sort select", () => {
    const orders = renderAdmin(createElement(OrdersTable));
    const products = renderAdmin(
      createElement(ProductsTable, {
        categoryOptions: [{ id: "c1", name: "Scrubs", section: "Women" }],
        canManage: true,
        canPublish: true,
      }),
    );
    const customers = renderAdmin(createElement(CustomersTable));
    for (const [name, html] of Object.entries({ orders, products, customers })) {
      assert.deepEqual(unnamedControls(html), [], `${name} list has unnamed controls`);
      // axe `empty-table-header`: the trailing actions column needs a (visually hidden) name.
      assert.ok(!/<th\b[^>]*><\/th>/.test(html), `${name} list has an empty <th>`);
    }
    assert.match(orders, /aria-label="Filter by status"/);
    assert.match(orders, /aria-label="Sort orders"/);
    assert.match(products, /aria-label="Filter by category"/);
    assert.match(products, /aria-label="Select all products on this page"/);
    assert.match(customers, /aria-label="Filter customers"/);
  });

  it("the products table names each row's checkbox after the product", () => {
    // Rows only exist after the client fetch, so this is a source check.
    const source = readFileSync("src/components/admin/products-table.tsx", "utf8");
    assert.match(source, /aria-label=\{`Select \$\{item\.name\}`\}/);
  });

  it("row-level status and role selects name the record they change", () => {
    const lead = renderAdmin(createElement(BulkLeadStatusSelect, { leadId: "l1", leadName: "Apollo Hospitals", currentStatus: "NEW" }));
    assert.match(lead, /aria-label="Status for Apollo Hospitals"/);

    const campaign = renderAdmin(
      createElement(CampaignStatusSelect, { campaignId: "c1", campaignName: "Diwali offer", currentStatus: "DRAFT" }),
    );
    assert.match(campaign, /aria-label="Status for Diwali offer"/);

    const journey = renderAdmin(
      createElement(JourneyStatusSelect, { journeyId: "j1", journeyName: "Welcome series", currentStatus: "ACTIVE" }),
    );
    assert.match(journey, /aria-label="Status for Welcome series"/);

    const enquiry = renderAdmin(
      createElement(ContactEnquiryStatusSelect, { enquiryId: "e1", enquiryName: "Asha Rao", currentStatus: "NEW" }),
    );
    assert.match(enquiry, /aria-label="Status for Asha Rao"/);

    const user = renderAdmin(
      h(
        "table",
        {},
        h(
          "tbody",
          {},
          createElement(UserRoleEditor, {
            currentUserId: "u0",
            user: { id: "u1", email: "jane@example.com", name: "Jane Doe", role: "VIEWER", active: true, lockedUntil: null },
          }),
        ),
      ),
    );
    assert.match(user, /aria-label="Role for Jane Doe"/);
    assert.match(user, /aria-label="Active: Jane Doe"/);
    assert.match(user, /aria-label="Reset password for Jane Doe"/);
    assert.deepEqual(unnamedControls(user), []);

    for (const html of [lead, campaign, journey, enquiry]) assert.deepEqual(unnamedControls(html), []);
  });

  it("Approve and Reject on the Hermes queue say which item they act on", () => {
    const html = renderAdmin(
      createElement(HermesApprovalActions, { approvalId: "a1", currentStatus: "PENDING", itemTitle: "Diwali blog draft" }),
    );
    assert.match(html, /aria-label="Approve Diwali blog draft"/);
    assert.match(html, /aria-label="Reject Diwali blog draft"/);
  });

  it("a pending item named after a task type does not make the launcher button ambiguous for the e2e specs", () => {
    // /api/admin/hermes/tasks titles the queue item "Hermes: daily seo health scan",
    // so the Approve/Reject names contain the launcher's label. A substring
    // locator on that label would match 5 buttons (strict-mode violation); the
    // specs must ask for the launcher by its exact name.
    const html = renderAdmin(
      h(
        "main",
        {},
        createElement(HermesTaskLauncher),
        createElement(HermesApprovalActions, {
          approvalId: "a1",
          currentStatus: "PENDING",
          itemTitle: "Hermes: daily seo health scan",
        }),
        createElement(HermesApprovalActions, {
          approvalId: "a2",
          currentStatus: "PENDING",
          itemTitle: "Scheduled: daily seo health scan",
        }),
      ),
    );
    const names = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
      (m) => /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? m[2].replace(/<[^>]+>/g, "").trim(),
    );
    assert.equal(names.filter((n) => /daily seo health scan/i.test(n)).length, 5);
    assert.equal(names.filter((n) => n === "Daily SEO Health Scan").length, 1);
    for (const file of ["tests/e2e/admin.spec.ts", "tests/e2e/dogfood.spec.ts"]) {
      const spec = readFileSync(file, "utf8");
      assert.ok(!/name:\s*\/daily seo health scan\/i/.test(spec), `${file} must not substring-match the launcher button`);
      assert.ok(spec.includes('name: "Daily SEO Health Scan", exact: true'), `${file} must use the launcher's exact name`);
    }
  });

  it("a settled Hermes approval shows words, not the raw enum", () => {
    const html = renderAdmin(createElement(HermesApprovalActions, { approvalId: "a1", currentStatus: "APPROVED" }));
    assert.match(html, />Approved</);
  });

  it("the order detail form ties Status, Tracking, Courier and Admin notes to their labels", () => {
    const html = renderAdmin(
      createElement(OrderDetailActions, {
        orderId: "o1",
        currentStatus: "PROCESSING",
        trackingNumber: null,
        courier: null,
        adminNotes: null,
        canManage: true,
        paymentMethod: "RAZORPAY",
        hasCapturedPayment: true,
        paymentRecorded: true,
        razorpayPaymentUrl: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.deepEqual(unnamedControls(html), []);
    assert.match(html, /<label for="[^"]+-status"[^>]*>\s*Status\s*<\/label>/);
  });

  it("the variant grid names each row's stock, price and active controls after the variant", () => {
    const html = renderAdmin(
      createElement(ProductVariantEditor, {
        categoryName: "Scrubs",
        productSlug: "classic-scrub-set",
        onChange: () => {},
        variants: [
          { size: "M", color: "Navy", colorHex: "#1e3a5f", sku: "CS-M-NAVY", stock: 5, active: true },
          { size: "L", color: "Navy", colorHex: "#1e3a5f", sku: "CS-L-NAVY", stock: 2, active: true },
        ],
      }),
    );
    assert.deepEqual(unnamedControls(html), []);
    assert.match(html, /aria-label="Stock for M \/ Navy"/);
    assert.match(html, /aria-label="Price override for L \/ Navy"/);
    assert.match(html, /aria-label="Active: M \/ Navy"/);
  });

  it("the size chart grid names every cell by its column and row", () => {
    const html = renderAdmin(
      createElement(SizeChartForm, {
        initial: {
          id: "s1",
          name: "Women's tops",
          unit: "IN",
          columns: ["Size", "Chest"],
          rows: [
            ["S", "34"],
            ["M", "36"],
          ],
          notes: null,
          categoryCount: 0,
          productCount: 0,
        },
      }),
    );
    assert.deepEqual(unnamedControls(html), []);
    assert.match(html, /aria-label="Chest for M"/);
  });

  it("each hero slide wires its labels to its own inputs, with ids that never repeat across slides", () => {
    const slide = (id: string) => ({
      id,
      enabled: true,
      eyebrow: "",
      headline: "Hello",
      subheadline: "",
      description: "",
      primaryCta: { label: "Shop", href: "/shop" },
      secondaryCta: null,
      image: null,
      secondaryImage: null,
    });
    const html = renderAdmin(createElement(HeroSlidesEditor, { initialContent: { slides: [slide("a"), slide("b")] } as never }));
    assert.deepEqual(unnamedControls(html), []);
    const ids = [...html.matchAll(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 14, `expected both slides' fields to carry ids, saw ${ids.length}`);
    assert.equal(new Set(ids).size, ids.length, "slide field ids must be unique");
  });

  it("/admin/homepage has one 'Headline' per slide plus the classic hero's, so the e2e spec must target the classic one by id", () => {
    const slide = (id: string) => ({
      id,
      enabled: true,
      eyebrow: "",
      headline: "Hello",
      subheadline: "",
      description: "",
      primaryCta: { label: "Shop", href: "/shop" },
      secondaryCta: null,
      image: null,
      secondaryImage: null,
    });
    const html = renderAdmin(
      h(
        "div",
        {},
        createElement(HeroSlidesEditor, { initialContent: { slides: [slide("a"), slide("b"), slide("c")] } as never }),
        createElement(HomepageEditor, {
          heroContent: {
            eyebrow: "",
            headline: "Hi",
            subheadline: "",
            description: "",
            primaryCta: "Shop",
            secondaryCta: "More",
            rating: "4.9",
            ratingLabel: "rated",
          },
        }),
      ),
    );
    assert.deepEqual(unnamedControls(html), []);
    // Three seeded slides + the classic Hero Section: four labels named exactly "Headline".
    assert.equal(count(html, /<label\b[^>]*>\s*Headline\s*<\/label>/g), 4);
    // ...but the classic editor's control has a unique, stable id the e2e spec can address.
    assert.equal(count(html, /<input\b[^>]*\bid="hero-headline"/g), 1);
    assert.equal(count(html, /\bid="hero-headline"/g), 1);
    const spec = readFileSync("tests/e2e/admin.spec.ts", "utf8");
    assert.ok(spec.includes('page.locator("#hero-headline")'), "homepage CMS e2e must scope to the classic hero headline");
    assert.ok(!/getByLabel\(\s*"Headline"/.test(spec), 'an unscoped getByLabel("Headline") is a strict-mode violation once slides exist');
  });

  it("the media library's search box and three filter selects are named", () => {
    // The browser renders inside a portal (needs `document`), so this is a source check.
    const source = readFileSync("src/components/admin/media-library-browser.tsx", "utf8");
    for (const name of ["Search images", "Filter by usage", "Filter by source", "Filter by date added"]) {
      assert.ok(source.includes(`aria-label="${name}"`), name);
    }
  });

  it("the Hermes page shows owner wording instead of raw identifiers", () => {
    const source = readFileSync("src/app/admin/(panel)/hermes/page.tsx", "utf8");
    assert.ok(!/\{item\.type\}/.test(source), "approval type must go through humanizeHermesLabel");
    assert.ok(!/\{task\.status\}/.test(source), "task status must go through humanizeHermesLabel");
    assert.ok(!source.includes("uppercase"), "an uppercase style would turn the label back into shouting enum text");
  });

  it("owner-facing copy no longer leaks audit ids, source paths or seed commands", () => {
    const copy: Array<[string, RegExp]> = [
      ["src/app/admin/(panel)/marketing/page.tsx", /grouped here \(release-hardening|Nothing moved/],
      ["src/app/admin/(panel)/offers/page.tsx", /database seed/i],
      ["src/app/admin/(panel)/journeys/page.tsx", /database seed/i],
      ["src/app/admin/(panel)/market/page.tsx", /Run seed/i],
      ["src/components/admin/segment-form.tsx", /src\/lib\/engagement\/segment-resolver/],
    ];
    for (const [file, leak] of copy) {
      assert.ok(!leak.test(readFileSync(file, "utf8")), `${file} still matches ${leak}`);
    }
  });

  it("the hero carousel help text points at the Hero Section that renders below it", () => {
    const page = readFileSync("src/app/admin/(panel)/homepage/page.tsx", "utf8");
    assert.ok(page.indexOf("<HeroSlidesEditor") < page.indexOf("<HomepageEditor"), "the carousel editor comes first on the page");
    const source = readFileSync("src/components/admin/hero-slides-editor.tsx", "utf8");
    assert.ok(!/Hero\s+Section above/.test(source));
    assert.match(source, /classic Hero Section below/);
  });
});
