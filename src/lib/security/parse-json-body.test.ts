import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_JSON_BODY_BYTES, readJsonBody } from "@/lib/security/parse-json-body";

describe("readJsonBody", () => {
  it("parses valid JSON", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", email: "t@example.com", message: "Hello world" }),
    });

    const result = await readJsonBody(request);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.data as { name: string }).name, "Test");
    }
  });

  it("rejects oversized content-length", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": String(MAX_JSON_BODY_BYTES + 1),
      },
      body: "{}",
    });

    const result = await readJsonBody(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 413);
    }
  });

  it("rejects invalid JSON", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    const result = await readJsonBody(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 400);
    }
  });

  it("rejects empty body", async () => {
    const request = new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    const result = await readJsonBody(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 400);
    }
  });
});
