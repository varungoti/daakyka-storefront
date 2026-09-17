import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTrustedImageUrl, TRUSTED_IMAGE_HOSTS } from "@/lib/security/image-hosts";

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
