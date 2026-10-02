import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CurrencyProvider } from "@/context/currency-provider";
import { ShopFiltersPanel } from "@/components/shop/shop-filters-panel";
import { defaultShopFilters, type ShopFacets, type ShopFilters } from "@/lib/shop/filters";

/**
 * release-hardening F-015/F-094/F-095: the Color, Size and Price Range blocks
 * are drawn only from the `facets` the page derives from its products — never
 * from a fixed seed-era list. The panel renders without a DOM, so these are
 * markup checks, like a11y-markup.test.ts.
 */

/** createElement with children passed positionally, for components whose props type requires `children`. */
const h = createElement as unknown as (
  type: unknown,
  props: Record<string, unknown>,
  ...children: unknown[]
) => ReactElement;

const facets: ShopFacets = {
  colors: [
    { name: "Navy", hex: "#1e3a5f", count: 36 },
    { name: "Sky Blue", hex: "#aee1f9", count: 8 },
    { name: "Pale Sky", hex: "#dceefb", count: 2 },
  ],
  sizes: [
    { value: "S", count: 25 },
    { value: "2-3Y", count: 10 },
    { value: "28", count: 16 },
    { value: "Made to Measure", count: 2 },
  ],
  price: { min: 149, max: 2999, step: 50 },
};

function render(props: { filters?: ShopFilters; facets?: ShopFacets }): string {
  return renderToStaticMarkup(
    h(
      CurrencyProvider,
      { freeShippingThresholdInr: 8000 },
      createElement(ShopFiltersPanel, {
        filters: props.filters ?? defaultShopFilters,
        onChange: () => {},
        categories: [],
        categoryCounts: {},
        totalCount: 0,
        facets: props.facets,
      }),
    ),
  );
}

/** The `<button>` whose label is exactly `label` (the whole element, so its attributes can be checked). */
function button(html: string, label: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((b) => b.includes(`>${label}<`)) ?? "";
}

const rangeInput = (html: string) => html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? "";

describe("ShopFiltersPanel facets", () => {
  it("draws no Color, Size or Price Range block without facets, rather than a fixed list that matches nothing", () => {
    const html = render({});
    assert.doesNotMatch(html, />Color</);
    assert.doesNotMatch(html, />Size</);
    assert.doesNotMatch(html, />Price Range</);
    for (const seed of ["Midnight Navy", "Lilac Purple", "Sage Green", "XXS", "5XL"]) {
      assert.ok(!html.includes(seed), `${seed} must not be rendered`);
    }
    // The blocks that don't depend on facets are untouched.
    assert.match(html, />Categories</);
    assert.match(html, />Availability</);
  });

  it("lists exactly the derived colours, with their counts and swatch colours", () => {
    const html = render({ facets });
    assert.match(html, />Color</);
    for (const color of facets.colors) {
      const rendered = button(html, color.name);
      assert.notEqual(rendered, "", `${color.name} is listed`);
      assert.ok(rendered.includes(`background-color:${color.hex}`), `${color.name} swatch uses its hex`);
      assert.ok(rendered.includes(`>${color.count}<`), `${color.name} shows its count`);
      // The count is a separate inline span, so without this a screen reader
      // would run it into the name ("Navy36").
      assert.ok(
        rendered.includes(`aria-label="${color.name}, ${color.count} products"`),
        `${color.name} has an accessible name with a separator`,
      );
    }
    assert.ok(!html.includes("Midnight Navy"));
  });

  it("lists exactly the derived sizes, including kids, school and linen ones, and no phantom sizes", () => {
    const html = render({ facets });
    assert.match(html, />Size</);
    for (const size of facets.sizes) {
      assert.notEqual(button(html, size.value), "", `${size.value} is listed`);
    }
    for (const phantom of ["XXS", "XS", "4XL", "5XL"]) {
      assert.equal(button(html, phantom), "", `${phantom} must not be rendered`);
    }
  });

  it("marks a selected colour or size as pressed whatever its case in the URL", () => {
    const html = render({
      facets,
      filters: { ...defaultShopFilters, colors: ["navy"], sizes: ["2-3y"] },
    });
    assert.match(button(html, "Navy"), /aria-pressed="true"/);
    assert.match(button(html, "Sky Blue"), /aria-pressed="false"/);
    assert.match(button(html, "2-3Y"), /aria-pressed="true"/);
    assert.match(button(html, "S"), /aria-pressed="false"/);
  });

  it("hides a facet that has fewer than two choices, since it narrows nothing", () => {
    const html = render({
      facets: {
        colors: [{ name: "Navy", hex: "#1e3a5f", count: 3 }],
        sizes: [{ value: "Standard", count: 3 }],
        price: null,
      },
    });
    assert.doesNotMatch(html, />Color</);
    assert.doesNotMatch(html, />Size</);
    assert.doesNotMatch(html, />Price Range</);
  });

  it("sets the price slider's range from the products, with the top stop meaning 'no limit'", () => {
    const slider = rangeInput(render({ facets }));
    assert.match(slider, /min="149"/);
    assert.match(slider, /max="2999"/);
    assert.match(slider, /step="50"/);
    // No cap set: parked at the top stop, announced as no limit.
    assert.match(slider, /value="2999"/);
    assert.match(slider, /aria-valuetext="Any price"/);
  });

  it("shows an active price cap at its own stop, as 'Up to', not 'N+'", () => {
    const html = render({ facets, filters: { ...defaultShopFilters, priceMax: 500 } });
    const slider = rangeInput(html);
    assert.match(slider, /value="500"/);
    assert.match(slider, /aria-valuetext="Up to [^"]*500"/);
    assert.ok(!/500\+/.test(html), "a maximum must not read as '500 and above'");
  });

  it("parks a cap outside the range at the nearest end instead of leaving the slider inconsistent", () => {
    assert.match(
      rangeInput(render({ facets, filters: { ...defaultShopFilters, priceMax: 50 } })),
      /value="149"/,
    );
    assert.match(
      rangeInput(render({ facets, filters: { ...defaultShopFilters, priceMax: 50_000 } })),
      /value="2999"/,
    );
  });
});
