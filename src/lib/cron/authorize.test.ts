import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeCron } from "@/lib/cron/authorize";
import { setNodeEnv, withEnv } from "../../../tests/helpers/env";

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/cron/journeys", {
    headers: header ? { authorization: header } : {},
  });
}

describe("authorizeCron", () => {
  it("allows an unauthenticated request in development when CRON_SECRET is unset", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    await withEnv({ CRON_SECRET: undefined }, () => {
      setNodeEnv("development");
      assert.equal(authorizeCron(requestWithAuth()), true);
      setNodeEnv(originalNodeEnv);
    });
  });

  it("denies when CRON_SECRET is unset outside development", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    await withEnv({ CRON_SECRET: undefined }, () => {
      setNodeEnv("production");
      assert.equal(authorizeCron(requestWithAuth()), false);
      setNodeEnv(originalNodeEnv);
    });
  });

  it("denies a request with no bearer header when CRON_SECRET is set", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth()), false);
    });
  });

  it("denies an incorrect bearer token", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth("Bearer wrong-secret")), false);
    });
  });

  it("allows a request with the correct bearer token", async () => {
    await withEnv({ CRON_SECRET: "cron-secret" }, () => {
      assert.equal(authorizeCron(requestWithAuth("Bearer cron-secret")), true);
    });
  });
});
