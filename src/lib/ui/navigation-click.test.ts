import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTrackableNavigationClick, type NavigationClick } from "@/lib/ui/navigation-click";
import { isNavigationPending, locationKey, settlePending } from "@/lib/ui/navigation-progress";

/**
 * F-091: a tap on a link to another page of the site shows the top progress
 * bar; anything that leaves the current page as it is must not.
 */
const click = (overrides: Partial<NavigationClick> = {}): NavigationClick => ({
  href: "https://daakyka.com/contact",
  target: "",
  download: false,
  currentHref: "https://daakyka.com/about",
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("isTrackableNavigationClick (F-091)", () => {
  it("tracks a plain click on a link to another page of the site", () => {
    assert.equal(isTrackableNavigationClick(click()), true);
    assert.equal(isTrackableNavigationClick(click({ target: "_self" })), true);
  });

  it("tracks a link that only changes the query string, which loads a different page state", () => {
    assert.equal(
      isTrackableNavigationClick(
        click({ href: "https://daakyka.com/shop?page=2", currentHref: "https://daakyka.com/shop?page=1" }),
      ),
      true,
    );
  });

  it("ignores a jump to an anchor on the same page, and the link to where the shopper already is", () => {
    assert.equal(
      isTrackableNavigationClick(click({ href: "https://daakyka.com/about#team" })),
      false,
    );
    assert.equal(isTrackableNavigationClick(click({ href: "https://daakyka.com/about" })), false);
    assert.equal(
      isTrackableNavigationClick(
        click({ href: "https://daakyka.com/products/a#reviews", currentHref: "https://daakyka.com/products/a" }),
      ),
      false,
    );
  });

  it("ignores clicks that open somewhere else: a modified click, a middle click, a new tab, a download", () => {
    for (const overrides of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { button: 2 },
      { target: "_blank" },
      { download: true },
    ] satisfies Partial<NavigationClick>[]) {
      assert.equal(isTrackableNavigationClick(click(overrides)), false, JSON.stringify(overrides));
    }
  });

  it("ignores other sites and non-web links", () => {
    assert.equal(isTrackableNavigationClick(click({ href: "https://example.com/contact" })), false);
    assert.equal(isTrackableNavigationClick(click({ href: "mailto:hello@daakyka.com" })), false);
    assert.equal(isTrackableNavigationClick(click({ href: "tel:+919876543210" })), false);
    assert.equal(isTrackableNavigationClick(click({ href: "https://wa.me/919876543210" })), false);
  });

  it("does not throw on an address it cannot parse", () => {
    assert.equal(isTrackableNavigationClick(click({ href: "" })), false);
    assert.equal(isTrackableNavigationClick(click({ currentHref: "not a url" })), false);
  });
});

/**
 * F-091 review: a link that only changes the query string is a navigation
 * (above), so the bar must also be hidden when only the query changes — it used
 * to watch the path alone and stayed up, frozen, until its 10 s give-up — and a
 * finished navigation must be forgotten so Back does not bring the bar back.
 */
describe("navigation progress state (F-091)", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("keys a location by its path and its query", () => {
    assert.equal(locationKey("/shop", params("")), "/shop");
    assert.equal(locationKey("/shop", params("page=2")), "/shop?page=2");
    assert.equal(locationKey("/shop", null), "/shop");
    assert.equal(locationKey(null, null), "");
    assert.notEqual(locationKey("/shop", params("page=1")), locationKey("/shop", params("page=2")));
  });

  it("writes the same location the same way every time, whatever the encoding it came in", () => {
    assert.equal(locationKey("/shop", params("q=a%20b")), locationKey("/shop", params("q=a+b")));
  });

  it("shows while the page the shopper tapped away from is still on screen", () => {
    const from = locationKey("/account/orders", params("page=1"));
    const pending = { from };
    assert.equal(isNavigationPending(pending, from), true);
    assert.equal(settlePending(pending, from), pending, "still the same navigation");
    assert.equal(isNavigationPending(null, from), false);
  });

  it("finishes a query-only navigation when the query changes, with the path unchanged", () => {
    const pending = { from: locationKey("/account/orders", params("page=1")) };
    const arrived = locationKey("/account/orders", params("page=2"));
    assert.equal(isNavigationPending(pending, arrived), false);
    assert.equal(settlePending(pending, arrived), null);
  });

  it("finishes the move from a filtered shop to the plain shop (same path, query dropped)", () => {
    const pending = { from: locationKey("/shop", params("category=tops")) };
    assert.equal(settlePending(pending, locationKey("/shop", params(""))), null);
  });

  it("finishes a move to another page", () => {
    const pending = { from: locationKey("/about", params("")) };
    assert.equal(settlePending(pending, locationKey("/contact", params(""))), null);
  });

  it("does not bring the bar back when the shopper presses Back to where the tap started", () => {
    const start = locationKey("/shop", params("page=1"));
    const next = locationKey("/shop", params("page=2"));
    let pending: { from: string } | null = { from: start };

    pending = settlePending(pending, next); // the page arrived
    assert.equal(pending, null);
    pending = settlePending(pending, start); // ...and Back to the page the tap began on
    assert.equal(isNavigationPending(pending, start), false);
  });
});
