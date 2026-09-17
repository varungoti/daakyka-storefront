import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeHermesRuntime } from "@/lib/hermes/runtime/auth";
import { withEnv } from "../../../../tests/helpers/env";

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/hermes/runtime/tasks", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

describe("authorizeHermesRuntime", () => {
  it("denies by default when HERMES_API_KEY is unset", async () => {
    await withEnv({ HERMES_API_KEY: undefined, CRON_SECRET: undefined }, () => {
      assert.equal(authorizeHermesRuntime(requestWithAuth()), false);
    });
  });

  it("denies when HERMES_API_KEY is unset even with a matching CRON_SECRET", async () => {
    // The runtime is a separate trust domain from cron — CRON_SECRET
    // must never be an accepted substitute.
    await withEnv({ HERMES_API_KEY: undefined, CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeHermesRuntime(requestWithAuth("Bearer cron-secret")), false);
    });
  });

  it("denies a request with no bearer header when a key is configured", async () => {
    await withEnv({ HERMES_API_KEY: "hermes-key" }, () => {
      assert.equal(authorizeHermesRuntime(requestWithAuth()), false);
    });
  });

  it("denies an incorrect bearer token", async () => {
    await withEnv({ HERMES_API_KEY: "hermes-key" }, () => {
      assert.equal(authorizeHermesRuntime(requestWithAuth("Bearer wrong-key")), false);
    });
  });

  it("allows a request with the correct bearer token", async () => {
    await withEnv({ HERMES_API_KEY: "hermes-key" }, () => {
      assert.equal(authorizeHermesRuntime(requestWithAuth("Bearer hermes-key")), true);
    });
  });
});
