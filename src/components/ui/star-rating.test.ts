import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StarRating } from "@/components/ui/star-rating";
import { CONDENSED_RATING_HTML } from "../../../tests/e2e/helpers/rated-card-fixture";

/**
 * F-021 follow-up: the 2-column phone listing grid renders product cards only
 * ~138px (320px viewport) to ~166px (375px) wide, and a card's content area is
 * 24px narrower than that. The full rating row (five stars + "4.5" + "(135)")
 * is ~135px, so on any card with an approved review it ran past the card's
 * right edge and was clipped by the card's `overflow-hidden` — the number and
 * review count silently disappeared. `condenseOnPhone` swaps the five stars for
 * one star below `sm`. Layout itself is checked in a real browser
 * (tests/e2e/mobile-layout.spec.ts); this pins the markup contract those
 * checks rely on, and that every other caller (PDP, admin, testimonials) is
 * unchanged. StarRating is stateless, so it renders without any provider.
 */
function render(props: Parameters<typeof StarRating>[0]) {
  return renderToStaticMarkup(createElement(StarRating, props));
}

const starCount = (html: string) => html.match(/lucide-star/g)?.length ?? 0;

describe("StarRating", () => {
  it("renders five stars, the rating and the review count by default, with no phone-only classes", () => {
    const html = render({ rating: 4.5, reviewCount: 135 });
    assert.equal(starCount(html), 5);
    assert.ok(html.includes(">4.5<"));
    assert.ok(html.includes(">(135)<"));
    assert.ok(!html.includes("max-sm:"), "the default rating must not change below sm");
    assert.ok(!html.includes("sm:hidden"));
  });

  it("fills as many stars as the rounded rating, and leaves the rest empty", () => {
    const html = render({ rating: 3.4 });
    assert.equal(html.match(/fill-amber-400/g)?.length, 3);
    assert.equal(html.match(/fill-transparent/g)?.length, 2);
  });

  it("omits the review count when none is passed", () => {
    const html = render({ rating: 4 });
    assert.ok(html.includes(">4.0<"));
    assert.ok(!html.includes("("));
  });

  describe("condenseOnPhone", () => {
    const html = render({ rating: 4.5, reviewCount: 135, condenseOnPhone: true });

    it("hides the row of five stars below sm and shows one star there instead", () => {
      // 5 in the row that is hidden on phones + 1 that is hidden from sm up.
      assert.equal(starCount(html), 6);
      assert.equal(html.match(/max-sm:hidden/g)?.length, 1);
      const lone = html.match(/<svg[^>]*class="[^"]*\bsm:hidden\b[^"]*"/g) ?? [];
      assert.equal(lone.length, 1);
      assert.ok(lone[0].includes("fill-amber-400"), "the single star is filled");
    });

    it("keeps the rating and the review count, in smaller type below sm", () => {
      assert.ok(/class="[^"]*max-sm:text-xs[^"]*">4\.5</.test(html));
      assert.ok(/class="[^"]*max-sm:text-xs[^"]*">\(135\)</.test(html));
    });

    it("keeps the full row from sm up: the stars group is only hidden below sm", () => {
      assert.ok(/<div class="flex items-center gap-0\.5 max-sm:hidden">/.test(html));
    });

    it("matches the markup tests/e2e/mobile-layout.spec.ts adds to cards without a rating", () => {
      // The spec can't render React itself (see rated-card-fixture.ts), so it
      // injects this string; if the component's markup changes, update the
      // fixture to match so the phone-width check keeps measuring the real thing.
      // Only the star outline's path data is left out — it has no layout effect.
      assert.equal(html.replace(/<path[^>]*><\/path>/g, ""), CONDENSED_RATING_HTML);
    });
  });
});
