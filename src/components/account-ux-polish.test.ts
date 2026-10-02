import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AccountNav } from "@/components/account/account-nav";
import { BulkOrderForm } from "@/components/bulk-orders/bulk-order-form";
import { ContactForm } from "@/components/contact/contact-form";
import { UnsubscribeForm } from "@/components/engagement/unsubscribe-form";
import { NewsletterSignup } from "@/components/layout/newsletter-signup";
import { CollectionNotice } from "@/components/legal/collection-notice";
import { NotifyWhenAvailable } from "@/components/product/notify-when-available";
import { WishlistItemRow } from "@/components/wishlist/wishlist-item-row";
import { CurrencyProvider } from "@/context/currency-provider";
import type { WishlistProduct } from "@/lib/wishlist/live-products";

/**
 * The markup contracts of the account-area polish batch (F-055, F-086, F-142,
 * F-144, F-314). Everything renders without a DOM: these are the first-render
 * outputs of the client components, which is what a shopper sees before any
 * interaction.
 */
const h = createElement as unknown as (
  type: unknown,
  props: Record<string, unknown>,
  ...children: unknown[]
) => ReactElement;

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (element: ReactElement) => renderToStaticMarkup(element);
const withCurrency = (child: ReactElement) => h(CurrencyProvider, { freeShippingThresholdInr: 8000 }, child);

describe("collection notices (F-314)", () => {
  it("CollectionNotice states the purpose and links the privacy policy in a new tab", () => {
    const html = render(createElement(CollectionNotice, { purpose: "We use your details only to reply." }));
    assert.match(html, /We use your details only to reply\./);
    assert.match(html, /<a [^>]*href="\/privacy-policy"[^>]*>Privacy Policy<\/a>/);
    // A shopper reading the policy must not lose the form they were filling in.
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener"/);
  });

  it("every data-collection form carries it: contact, bulk order, newsletter and back-in-stock", () => {
    const forms: Record<string, ReactElement> = {
      contact: createElement(ContactForm),
      "bulk order": createElement(BulkOrderForm),
      newsletter: createElement(NewsletterSignup),
      "back in stock": createElement(NotifyWhenAvailable, { variantId: "v1" }),
    };
    for (const [name, element] of Object.entries(forms)) {
      const html = render(element);
      assert.match(html, /href="\/privacy-policy"/, `${name} form must link the privacy policy`);
    }
  });

  it("adds no pre-ticked consent box anywhere", () => {
    for (const element of [createElement(BulkOrderForm), createElement(NewsletterSignup)]) {
      const html = render(element);
      assert.doesNotMatch(html, /type="checkbox"[^>]*\bchecked(=|\s|>)/);
    }
  });
});

describe("footer newsletter field (F-086)", () => {
  const html = render(createElement(NewsletterSignup));
  const input = html.match(/<input[^>]*type="email"[^>]*>/)?.[0] ?? "";

  it("labels the email field and names it for autofill", () => {
    assert.match(input, /aria-label="Email address"/);
    assert.match(input, /name="email"/);
    assert.match(input, /autoComplete="email"|autocomplete="email"/i);
    assert.match(input, /inputMode="email"|inputmode="email"/i);
  });

  it("is 16px below sm, so iOS Safari does not zoom the page on focus", () => {
    assert.match(input, /\btext-base\b/);
    assert.match(input, /\bsm:text-sm\b/);
    assert.doesNotMatch(input, /(^|[\s"])text-sm\b/);
  });
});

describe("unsubscribe page (F-055)", () => {
  it("offers the button for a link with a token", () => {
    const html = render(createElement(UnsubscribeForm, { token: "cm2xg8f9v0000p4oh1a2b3c4d", contactEmail: "hello@daakyka.com" }));
    assert.match(html, />Unsubscribe</);
    assert.doesNotMatch(html, /invalid or has expired/);
  });

  it("explains a link with no token and gives the shopper a way forward, not a retry", () => {
    const html = render(createElement(UnsubscribeForm, { token: "", contactEmail: "hello@daakyka.com" }));
    assert.match(html, /invalid or has expired/);
    assert.match(html, /href="mailto:hello@daakyka\.com"/);
    assert.doesNotMatch(html, /try again/i);
    assert.doesNotMatch(html, /<button/, "there is nothing to click for a link that can never work");
  });

  it("points at the contact page when the store has no contact email set", () => {
    const html = render(createElement(UnsubscribeForm, { token: "", contactEmail: "" }));
    assert.match(html, /href="\/contact"/);
    assert.doesNotMatch(html, /mailto:/);
  });
});

describe("account navigation (F-144)", () => {
  it("ends with a Sign Out button, so it is reachable from every account page", () => {
    const html = render(h(AppRouterContext.Provider, { value: router }, createElement(AccountNav)));
    assert.match(html, /<button[^>]*>Sign Out<\/button>/);
    // It comes after the section links.
    assert.ok(html.indexOf("Sign Out") > html.indexOf("Profile"));
  });

  it("is no longer repeated at the bottom of the Profile tab", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/account/account-tabs.tsx"), "utf8");
    assert.doesNotMatch(source, /<LogoutButton/);
  });
});

describe("resend verification confirmation (F-146)", () => {
  it("keeps its own text styling when the caller passes only layout classes", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/account/resend-verification-button.tsx"), "utf8");
    // `className` used to replace the styling (`className ?? "text-sm ..."`).
    assert.doesNotMatch(source, /className \?\? /);
    assert.match(source, /cn\("text-sm font-medium text-trust-ink", className\)/);
  });
});

describe("wishlist row (F-113, F-142)", () => {
  const product: WishlistProduct = {
    id: "p1",
    handle: "womens-vneck-scrub-top",
    name: "Women's V-Neck Scrub Top",
    colorName: "Wine",
    price: 1399,
    compareAtPrice: 1799,
    image: "/cdn/media/product/wine.webp",
    category: "tops",
    available: true,
  };
  const entry = { id: "p1", handle: "womens-vneck-scrub-top" };
  const renderRow = (props: Record<string, unknown>) =>
    render(withCurrency(h("ul", {}, createElement(WishlistItemRow, { entry, onRemove: () => {}, ...props } as never))));

  it("formats the live price with Indian digit grouping, not a bare '₹1399'", () => {
    const html = renderRow({ product });
    assert.match(html, /₹1,399/);
    assert.doesNotMatch(html, /₹1399/);
  });

  it("shows the photo, the colour, the MRP and the actions", () => {
    const html = renderRow({ product });
    assert.match(html, /<img[^>]*src="[^"]*wine[^"]*"/);
    assert.match(html, />Wine</);
    assert.match(html, /MRP /);
    assert.match(html, /₹1,799/);
    assert.match(html, /href="\/products\/womens-vneck-scrub-top"/);
    assert.match(html, />Choose size</);
    assert.match(html, /aria-label="Remove Women&#x27;s V-Neck Scrub Top from wishlist"/);
  });

  it("says Sold out, and offers View instead of Choose size, for an unavailable product", () => {
    const html = renderRow({ product: { ...product, available: false } });
    assert.match(html, /Sold out/);
    assert.match(html, />View</);
    assert.doesNotMatch(html, />Choose size</);
  });

  it("falls back to a readable name from the handle, still removable, while the live data is missing", () => {
    const html = renderRow({ product: null, loading: false });
    assert.match(html, /Womens vneck scrub top/);
    assert.match(html, />Remove</);
    assert.doesNotMatch(html, /₹/);
  });

  it("holds a place for the price while the live data loads", () => {
    const html = renderRow({ product: null, loading: true });
    assert.match(html, /animate-pulse/);
  });
});

describe("pdp and navigation sources (F-090, F-091, F-114)", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("desktop nav labels never wrap, and are tighter between lg and xl (F-090)", () => {
    const source = read("src/components/layout/header.tsx");
    const constant = source.match(/const NAV_ITEM_CLASSES =\s*"([^"]*)"/)?.[1] ?? "";
    assert.match(constant, /\bwhitespace-nowrap\b/);
    assert.match(constant, /\bpx-2\.5\b/);
    assert.match(constant, /\bxl:px-4\b/);
    // Both the plain links and the dropdown triggers use it.
    assert.equal(source.match(/NAV_ITEM_CLASSES/g)?.length, 3, "defined once, used by links and triggers");
  });

  it("no segment layer gets a root loading.tsx (it would turn real 404s into soft 404s), the progress bar is mounted instead (F-091)", () => {
    assert.throws(() => read("src/app/loading.tsx"), /ENOENT/);
    assert.match(read("src/app/layout.tsx"), /<NavigationProgress \/>/);
  });

  it("the progress bar finishes on a query-only change and forgets a finished navigation (F-091)", () => {
    const source = read("src/components/layout/navigation-progress.tsx");
    // It must see the query string, or a ?page=2 link would leave the bar up
    // until the give-up timer.
    assert.match(source, /locationKey\(usePathname\(\), useSearchParams\(\)\)/);
    // useSearchParams needs a Suspense boundary of its own so no page is made to
    // client-render; layout.tsx still mounts the single exported component.
    assert.match(source, /<Suspense fallback=\{null\}>\s*<NavigationProgressBar \/>\s*<\/Suspense>/);
    // A finished navigation is dropped (Back must not show the bar again) ...
    assert.match(source, /settlePending\(pending, currentKey\)/);
    // ... and the location is no longer compared by bare path.
    assert.doesNotMatch(source, /leaving/);
    assert.doesNotMatch(source, /window\.location\.pathname/);
  });

  it("the image viewer leaves presses on its arrows to the arrows (F-114)", () => {
    const source = read("src/components/ui/image-lightbox.tsx").replace(/\r\n/g, "\n");
    const down = source.slice(source.indexOf("const onPointerDown"), source.indexOf("const onPointerMove"));
    assert.ok(down.length > 0, "onPointerDown not found");
    // The guard comes first: before the pointer is tracked and before it is captured.
    const guard = down.indexOf("startsOnControl(event.target as Element)");
    assert.ok(guard >= 0, "onPointerDown must skip presses that start on a control");
    assert.ok(guard < down.indexOf("pointers.current.set"), "guard before tracking");
    assert.ok(guard < down.indexOf("setPointerCapture"), "guard before capturing");
    // Releases of a press that was never tracked are ignored, not counted as a drag.
    const up = source.slice(source.indexOf("const onPointerUp"), source.indexOf("const current ="));
    assert.match(up, /if \(!pointers\.current\.has\(event\.pointerId\)\) return;/);
    // The arrows really are inside the element that captures the pointer.
    const container = source.slice(source.indexOf("onPointerDown={onPointerDown}"));
    assert.match(container, /aria-label="Previous image"/);
    assert.match(container, /aria-label="Next image"/);
  });

  it("names the selected colour, keeps white swatches visible and uses 44px targets (F-114)", () => {
    const source = read("src/components/product/product-detail.tsx");
    assert.match(source, /Color: <span className="text-ink">\{selectedColor\}<\/span>/);
    assert.doesNotMatch(source, /border-transparent hover:border-border/);
    assert.match(source, /"border-border hover:border-brand\/50"/);
    assert.equal(source.match(/min-h-11 min-w-11/g)?.length, 2, "both quantity buttons");
    assert.match(source, /inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand/);
  });
});
