import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { proxy } from "@/proxy";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { signSessionToken } from "@/lib/auth/session";

describe("admin security", () => {
  it("proxy blocks unauthenticated /api/admin requests", async () => {
    const request = new NextRequest("http://localhost/api/admin/blog");
    const response = await proxy(request);
    assert.equal(response.status, 401);
  });

  it("proxy redirects unauthenticated /admin panel to login", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    const response = await proxy(request);
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/admin\/login$/);
  });

  it("proxy allows /admin/login without session", async () => {
    const request = new NextRequest("http://localhost/admin/login");
    const response = await proxy(request);
    assert.equal(response.status, 200);
  });

  // F7 (docs/audit-2026-09-19/security.md): proxy.ts's coarse gate is
  // intentionally DB-free (see verifyAdminToken's doc comment), but it
  // now also validates the token's claim shape (a non-empty `sub` and a
  // numeric `sv`) — cheaply, with no DB call — matching
  // verifySessionToken's own pre-DB shape check.
  describe("verifyAdminToken claim-shape validation", () => {
    it("allows a validly-signed, well-shaped session token through the coarse gate", async () => {
      const token = await signSessionToken(
        { id: "user-1", email: "admin@example.com", name: "Admin", role: "SUPER_ADMIN" },
        0,
      );
      const request = new NextRequest("http://localhost/api/admin/blog", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      });
      const response = await proxy(request);
      assert.equal(response.status, 200);
    });

    it("rejects a validly-signed token missing the sessionVersion (sv) claim", async () => {
      const secret = process.env.AUTH_SECRET;
      assert.ok(secret, "AUTH_SECRET must be set for this test");
      const malformedToken = await new SignJWT({ sub: "user-1", email: "admin@example.com" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret));

      const request = new NextRequest("http://localhost/api/admin/blog", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${malformedToken}` },
      });
      const response = await proxy(request);
      assert.equal(response.status, 401);
    });

    it("rejects a validly-signed token missing the sub claim", async () => {
      const secret = process.env.AUTH_SECRET;
      assert.ok(secret, "AUTH_SECRET must be set for this test");
      const malformedToken = await new SignJWT({ email: "admin@example.com", sv: 0 })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret));

      const request = new NextRequest("http://localhost/api/admin/blog", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${malformedToken}` },
      });
      const response = await proxy(request);
      assert.equal(response.status, 401);
    });

    it("rejects a token signed with the wrong secret regardless of shape", async () => {
      const forgedToken = await new SignJWT({ sub: "user-1", email: "admin@example.com", sv: 0 })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("not-the-real-auth-secret"));

      const request = new NextRequest("http://localhost/api/admin/blog", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${forgedToken}` },
      });
      const response = await proxy(request);
      assert.equal(response.status, 401);
    });
  });
});
