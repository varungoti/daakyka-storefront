import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

  it("rejects a subdomain trick (e.g. daakyka.com.evil.com)", () => {
    assert.equal(isTrustedImageUrl("https://daakyka.com.evil.com/photo.jpg"), false);
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
    await withEnv({ R2_PUBLIC_BASE_URL: "https://daakyka.com" }, () => {
      const hosts = getTrustedImageHosts();
      assert.equal(hosts.filter((h) => h === "daakyka.com").length, 1);
    });
  });
});
