import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_REVALIDATE_PROFILE } from "@/lib/cache/admin-revalidate";

describe("ADMIN_REVALIDATE_PROFILE (F-032 / F-214)", () => {
  it("is the immediate-expiry profile, never the stale-while-revalidate 'max'", () => {
    assert.deepEqual(ADMIN_REVALIDATE_PROFILE, { expire: 0 });
  });
});

// Several of these modules call next/cache's revalidateTag directly (no
// injectable seam, and next/cache can't be spied on from a test — see
// src/lib/homepage/index.ts), so the one thing a unit test CAN pin is that
// no admin-write module goes back to `revalidateTag(<tag>, "max")`. A "max"
// call here means the owner's first reload after Save serves the old price,
// hero, offer or setting (F-032, F-214). The injectable ones (homepage,
// offers, testimonials, blog) are also asserted by value in their own
// index.test.ts.
const ADMIN_WRITE_MODULES = [
  "src/lib/catalog/products.ts",
  "src/lib/catalog/categories.ts",
  "src/lib/catalog/size-charts.ts",
  "src/lib/catalog/product-import.ts",
  "src/lib/settings/index.ts",
  "src/lib/homepage/index.ts",
  "src/lib/offers/index.ts",
  "src/lib/testimonials/index.ts",
  "src/lib/blog/index.ts",
  "src/lib/media/store.ts",
];

describe("admin-write modules never invalidate with the stale-while-revalidate 'max' profile", () => {
  for (const relativePath of ADMIN_WRITE_MODULES) {
    it(relativePath, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      const staleCalls = source.match(/revalidate(?:Tag)?\(\s*[A-Za-z_.]+\s*,\s*["']max["']\s*\)/g);
      assert.equal(staleCalls, null, `found a "max" revalidation in ${relativePath}: ${staleCalls?.join(", ")}`);
    });
  }
});
