import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

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
});
