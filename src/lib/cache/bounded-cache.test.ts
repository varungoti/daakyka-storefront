import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { unstable_cache } from "next/cache";
import {
  BOUNDED_CACHE_KEY_VERSION,
  BOUNDED_CACHE_REVALIDATE_SECONDS,
  boundedCache,
} from "@/lib/cache/bounded-cache";

type CacheCall = {
  fetcher: unknown;
  keyParts: string[] | undefined;
  options: { revalidate?: number | false; tags?: string[] } | undefined;
};

/** A stand-in for next/cache's unstable_cache that records what it was given
 * (the real one cannot be spied on from a test — see bounded-cache.ts). */
function recorder() {
  const calls: CacheCall[] = [];
  const cache = ((fetcher: unknown, keyParts?: string[], options?: CacheCall["options"]) => {
    calls.push({ fetcher, keyParts, options });
    return fetcher;
  }) as unknown as typeof unstable_cache;
  return { calls, cache };
}

// F-273 / F-070 review follow-up: a tag-only unstable_cache never expires on
// its own, and prisma/seed-corrections.ts + the seed's offer step run inside
// the Vercel build where revalidateTag cannot be called. These pin the bound.
describe("boundedCache", () => {
  it("always passes a numeric revalidate of five minutes or less", () => {
    const { calls, cache } = recorder();
    boundedCache(async () => 1, ["k"], ["tag"], cache);
    assert.equal(calls.length, 1);
    const revalidate = calls[0]!.options?.revalidate;
    assert.equal(typeof revalidate, "number", "revalidate must be a number, not undefined/false (= cached forever)");
    assert.ok((revalidate as number) > 0 && (revalidate as number) <= 300);
    assert.equal(revalidate, BOUNDED_CACHE_REVALIDATE_SECONDS);
  });

  it("keeps the caller's tags so an admin save still invalidates immediately", () => {
    const { calls, cache } = recorder();
    boundedCache(async () => 1, ["k"], ["categories", "products"], cache);
    assert.deepEqual(calls[0]!.options?.tags, ["categories", "products"]);
  });

  it("puts the key version in front of the caller's key parts, so entries cached before the bound existed are never read", () => {
    const { calls, cache } = recorder();
    boundedCache(async () => 1, ["size-chart-for-product", "prod_1"], ["t"], cache);
    assert.deepEqual(calls[0]!.keyParts, [BOUNDED_CACHE_KEY_VERSION, "size-chart-for-product", "prod_1"]);
    // The unbounded entries were written under the bare key parts.
    assert.notDeepEqual(calls[0]!.keyParts, ["size-chart-for-product", "prod_1"]);
  });

  it("returns the cached function unchanged and hands the fetcher through", () => {
    const { calls, cache } = recorder();
    const fetcher = async () => "value";
    const cached = boundedCache(fetcher, ["k"], ["t"], cache);
    assert.equal(calls[0]!.fetcher, fetcher);
    assert.equal(cached, fetcher);
  });

  it("builds against the real next/cache by default without throwing outside a Next request", () => {
    assert.doesNotThrow(() => boundedCache(async () => 1, ["k"], ["t"]));
  });
});

// The helper only helps if the modules whose data the seed corrects use it.
// A raw `unstable_cache(` here would quietly bring back an entry that is
// cached until someone saves the same record in /admin.
describe("seed-corrected reads go through boundedCache", () => {
  const modules = ["src/lib/catalog/size-charts.ts", "src/lib/offers/index.ts"];

  for (const file of modules) {
    it(`${file} has no tag-only unstable_cache call`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const code = source
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.ok(!/\bunstable_cache\s*\(/.test(code), `${file} calls unstable_cache directly; use boundedCache`);
      assert.match(code, /\bboundedCache\s*\(/);
    });
  }
});
