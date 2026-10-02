import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accountLoginPath, sanitizeReturnTo } from "@/lib/customer-auth/return-to";

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

// F-131: every page that bounces a signed-out visitor to the login page builds the
// URL with this, so signing in lands them back on the exact page they asked for.
describe("accountLoginPath", () => {
  it("carries the full path as an encoded returnTo", () => {
    assert.equal(accountLoginPath("/account/addresses"), "/account/login?returnTo=%2Faccount%2Faddresses");
    assert.equal(
      accountLoginPath("/account/orders/DK-2026-0000000001"),
      "/account/login?returnTo=%2Faccount%2Forders%2FDK-2026-0000000001",
    );
  });

  it("keeps a query string inside returnTo instead of splitting it off as a login parameter", () => {
    const url = new URL(accountLoginPath("/account/orders?page=3"), "https://daakyka.com");
    assert.equal(url.pathname, "/account/login");
    assert.deepEqual([...url.searchParams.keys()], ["returnTo"]);
    assert.equal(url.searchParams.get("returnTo"), "/account/orders?page=3");
  });

  it("round-trips through sanitizeReturnTo, which is what the login page applies", () => {
    for (const path of ["/account/orders/DK-X", "/account/orders?page=2", "/account/profile"]) {
      const returnTo = new URL(accountLoginPath(path), "https://daakyka.com").searchParams.get("returnTo");
      assert.equal(sanitizeReturnTo(returnTo), path);
    }
  });

  it("never names another site: an unusable value falls back to /account", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "account", "/x?u=https://evil.com", ""]) {
      assert.equal(accountLoginPath(bad), "/account/login?returnTo=%2Faccount", bad);
    }
  });
});
