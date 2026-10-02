import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTrackableNavigationClick, type NavigationClick } from "@/lib/ui/navigation-click";

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
