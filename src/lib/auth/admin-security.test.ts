import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("admin security", () => {
  it("middleware blocks unauthenticated /api/admin requests", async () => {
    const request = new NextRequest("http://localhost/api/admin/blog");
    const response = await middleware(request);
    assert.equal(response.status, 401);
  });

  it("middleware redirects unauthenticated /admin panel to login", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    const response = await middleware(request);
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/admin\/login$/);
  });

  it("middleware allows /admin/login without session", async () => {
    const request = new NextRequest("http://localhost/admin/login");
    const response = await middleware(request);
    assert.equal(response.status, 200);
  });
});
