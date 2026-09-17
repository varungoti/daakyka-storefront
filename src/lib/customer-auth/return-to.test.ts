import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeReturnTo } from "@/lib/customer-auth/return-to";

describe("sanitizeReturnTo", () => {
  it("accepts a plain relative path", () => {
    assert.equal(sanitizeReturnTo("/account"), "/account");
  });

  it("accepts a nested relative path with a query string", () => {
    assert.equal(sanitizeReturnTo("/shop?category=hospital"), "/shop?category=hospital");
  });

  it("falls back to /account for null/undefined/empty", () => {
    assert.equal(sanitizeReturnTo(null), "/account");
    assert.equal(sanitizeReturnTo(undefined), "/account");
    assert.equal(sanitizeReturnTo(""), "/account");
  });

  it("falls back for a custom default", () => {
    assert.equal(sanitizeReturnTo(null, "/shop"), "/shop");
  });

  it("rejects an absolute URL to another host", () => {
    assert.equal(sanitizeReturnTo("https://evil.com"), "/account");
    assert.equal(sanitizeReturnTo("http://evil.com/phish"), "/account");
  });

  it("rejects a protocol-relative URL", () => {
    assert.equal(sanitizeReturnTo("//evil.com"), "/account");
  });

  it("rejects a backslash-based protocol-relative trick", () => {
    assert.equal(sanitizeReturnTo("/\\evil.com"), "/account");
    assert.equal(sanitizeReturnTo("\\\\evil.com"), "/account");
  });

  it("rejects a value that doesn't start with a slash", () => {
    assert.equal(sanitizeReturnTo("account"), "/account");
    assert.equal(sanitizeReturnTo("javascript:alert(1)"), "/account");
  });

  it("rejects a value embedding an absolute URL mid-string", () => {
    assert.equal(sanitizeReturnTo("/redirect?to=https://evil.com"), "/account");
  });

  it("rejects control characters (header-injection defense)", () => {
    assert.equal(sanitizeReturnTo("/account\r\nSet-Cookie: x=1"), "/account");
  });

  it("rejects an overlong value", () => {
    assert.equal(sanitizeReturnTo(`/${"a".repeat(3000)}`), "/account");
  });
});
