import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getTrustedImageHosts,
  isTrustedImageUrl,
  TRUSTED_IMAGE_HOSTS,
} from "@/lib/security/image-hosts";
import { withEnv } from "../../../tests/helpers/env";

describe("isTrustedImageUrl", () => {
  it("allows every host in the trusted list", () => {
    for (const host of TRUSTED_IMAGE_HOSTS) {
      assert.equal(isTrustedImageUrl(`https://${host}/photo.jpg`), true, host);
    }
  });

  it("rejects an untrusted host", () => {
    assert.equal(isTrustedImageUrl("https://evil.example.com/photo.jpg"), false);
  });

  it("rejects a cloud metadata / internal address disguised as a path", () => {
    assert.equal(isTrustedImageUrl("https://169.254.169.254/latest/meta-data/"), false);
  });

  it("rejects http (non-https) even for a trusted host", () => {
    assert.equal(isTrustedImageUrl("http://images.unsplash.com/photo.jpg"), false);
  });

  it("rejects a subdomain trick (e.g. images.pexels.com.evil.com)", () => {
    assert.equal(isTrustedImageUrl("https://images.pexels.com.evil.com/photo.jpg"), false);
  });

  it("rejects daakyka.com — removed from the trusted list, see image-hosts.ts", () => {
    assert.equal(isTrustedImageUrl("https://daakyka.com/photo.jpg"), false);
  });

  it("rejects malformed input without throwing", () => {
    assert.doesNotThrow(() => isTrustedImageUrl("not-a-url"));
    assert.equal(isTrustedImageUrl("not-a-url"), false);
  });
});

describe("getTrustedImageHosts / R2_PUBLIC_BASE_URL", () => {
  it("returns exactly the static list when R2_PUBLIC_BASE_URL is unset", async () => {
    await withEnv({ R2_PUBLIC_BASE_URL: undefined }, () => {
      assert.deepEqual(getTrustedImageHosts(), TRUSTED_IMAGE_HOSTS);
    });
  });

  it("adds the R2 public host when R2_PUBLIC_BASE_URL is a valid https URL", async () => {
    await withEnv({ R2_PUBLIC_BASE_URL: "https://media.daakyka-cdn.com" }, () => {
      const hosts = getTrustedImageHosts();
      assert.ok(hosts.includes("media.daakyka-cdn.com"));
      assert.equal(isTrustedImageUrl("https://media.daakyka-cdn.com/media/product/2026/09/x.webp"), true);
    });
  });

  it("ignores an http (non-https) R2_PUBLIC_BASE_URL", async () => {
    await withEnv({ R2_PUBLIC_BASE_URL: "http://media.daakyka-cdn.com" }, () => {
      assert.deepEqual(getTrustedImageHosts(), TRUSTED_IMAGE_HOSTS);
    });
  });

  it("ignores a malformed R2_PUBLIC_BASE_URL without throwing", async () => {
    await withEnv({ R2_PUBLIC_BASE_URL: "not-a-url" }, () => {
      assert.doesNotThrow(() => getTrustedImageHosts());
      assert.deepEqual(getTrustedImageHosts(), TRUSTED_IMAGE_HOSTS);
    });
  });

  it("does not duplicate a host already in the static trusted list", async () => {
    await withEnv({ R2_PUBLIC_BASE_URL: "https://images.pexels.com" }, () => {
      const hosts = getTrustedImageHosts();
      assert.equal(hosts.filter((h) => h === "images.pexels.com").length, 1);
    });
  });
});

/**
 * Regression guard for the /about hotlinking bug (Task A, 2026-09-20): a
 * hardcoded external image URL in a rendered component is exactly how
 * daakyka.com ended up hotlinked from src/data/media/catalog.ts in the
 * first place. This scans every .ts/.tsx file under src/app and
 * src/components for a literal `https://...` URL that looks like an image
 * (by file extension) and asserts its host is in the trusted list — cheap
 * (a handful of directories, a regex pass) and doesn't need a running
 * server or DB.
 */
describe("rendered components never hotlink an untrusted image host", () => {
  const SOURCE_ROOTS = ["src/app", "src/components"];
  const IMAGE_URL_PATTERN =
    /https:\/\/[^\s"'`)]+\.(?:jpe?g|png|webp|gif|avif|svg)(?:\?[^\s"'`)]*)?/gi;

  function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...listSourceFiles(full));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("no hardcoded image URL under src/app or src/components names a host outside the trusted list", () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      const dir = path.join(process.cwd(), root);
      if (!fs.existsSync(dir)) continue;
      for (const file of listSourceFiles(dir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(IMAGE_URL_PATTERN)) {
          let host: string;
          try {
            host = new URL(match[0]).hostname;
          } catch {
            continue;
          }
          if (!getTrustedImageHosts().includes(host)) {
            offenders.push(`${path.relative(process.cwd(), file)}: ${match[0]}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
