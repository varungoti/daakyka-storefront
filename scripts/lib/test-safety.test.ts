import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  assertDisposableDatabase,
  assertDisposableEnvironment,
  assertDisposableRun,
  databaseGuardProblem,
} from "./assert-disposable-db.mjs";
import {
  KNOWN_PRODUCTION_HOSTS,
  isLocalTarget,
  isProductionTarget,
  productionHosts,
  productionTargetProblem,
} from "./assert-not-production.mjs";

/**
 * F-080 / F-077 / F-076 / F-252: the guards that keep the destructive test
 * suites and the remote verification gates away from production, and the
 * wiring that makes them unavoidable. No database and no network beyond a
 * loopback stub server.
 */

const repoRoot = process.cwd();

/** A child's whole environment: only PATH plus what the test gives it, so
 * nothing ambient (a real DATABASE_URL, say) can reach the script under test. */
function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", ...extra } as unknown as NodeJS.ProcessEnv;
}
const PROD_URL = "postgresql://postgres.abc:prodpassword@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
const LOCAL_URL = "postgresql://daakyka:daakyka@localhost:5432/daakyka_dev";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("databaseGuardProblem (F-080)", () => {
  it("accepts a throwaway local database on every local host", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "postgres", "LOCALHOST"]) {
      assert.equal(databaseGuardProblem(`postgresql://u:p@${host}:5432/daakyka_fix_x`), null, host);
    }
  });

  it("refuses an unset URL and one it cannot parse", () => {
    assert.match(databaseGuardProblem(undefined) ?? "", /not set/);
    assert.match(databaseGuardProblem("not a url") ?? "", /not a parseable/);
    assert.match(databaseGuardProblem("mysql://u:p@localhost/db") ?? "", /not a parseable/);
    // A password with an unescaped # makes the host unreadable: refuse, never guess.
    assert.match(databaseGuardProblem("postgresql://u:pa#ss@prod.supabase.com:5432/db") ?? "", /not a parseable/);
  });

  it("refuses the production database however it is spelled", () => {
    assert.match(databaseGuardProblem(PROD_URL, { prodUrl: PROD_URL }) ?? "", /identical to SUPABASE_DATABASE_URL/);
    // Same host as production, different database/credentials.
    assert.match(
      databaseGuardProblem("postgresql://other:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/test", { prodUrl: PROD_URL }) ?? "",
      /production database host/,
    );
    // A Supabase host is production even when SUPABASE_DATABASE_URL is not set.
    assert.match(databaseGuardProblem("postgresql://u:p@db.myproject.supabase.co:5432/postgres") ?? "", /production database host/);
    assert.match(databaseGuardProblem("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres") ?? "", /production database host/);
  });

  it("refuses a production host smuggled in through a host= query override, which node-postgres lets win", () => {
    assert.match(
      databaseGuardProblem("postgresql://u:p@localhost:5432/db?host=aws-0-x.pooler.supabase.com") ?? "",
      /production database host/,
    );
    assert.match(databaseGuardProblem("postgresql://u:p@localhost:5432/db?host=db.example.com") ?? "", /not a local database/);
  });

  it("refuses any other remote host unless it is explicitly declared disposable", () => {
    const remote = "postgresql://u:p@db.example.com:5432/test";
    assert.match(databaseGuardProblem(remote) ?? "", /not a local database/);
    assert.equal(databaseGuardProblem(remote, { allowRemote: true }), null);
  });

  it("never lets the remote override reach production", () => {
    assert.match(databaseGuardProblem(PROD_URL, { prodUrl: PROD_URL, allowRemote: true }) ?? "", /identical/);
    assert.match(databaseGuardProblem(PROD_URL, { allowRemote: true }) ?? "", /production database host/);
  });

  it("never prints the password or the full URL", () => {
    const messages = [
      databaseGuardProblem(PROD_URL, { prodUrl: PROD_URL }),
      databaseGuardProblem(PROD_URL),
      databaseGuardProblem("postgresql://u:hunter2@db.example.com:5432/test"),
    ];
    for (const message of messages) {
      assert.ok(message);
      assert.ok(!/prodpassword|hunter2|postgres\.abc/.test(message), message);
    }
  });

  it("assertDisposableDatabase throws for a refused URL and returns for a local one", () => {
    assert.throws(() => assertDisposableDatabase(PROD_URL, { prodUrl: PROD_URL }), /Refusing to run against this database/);
    assert.doesNotThrow(() => assertDisposableDatabase(LOCAL_URL, { prodUrl: PROD_URL }));
  });
});

describe("assertDisposableEnvironment / assertDisposableRun (F-080)", () => {
  it("checks DATABASE_URL against SUPABASE_DATABASE_URL, the case a swapped .env produces", () => {
    assert.throws(
      () => assertDisposableEnvironment({ DATABASE_URL: PROD_URL, SUPABASE_DATABASE_URL: PROD_URL }),
      /identical to SUPABASE_DATABASE_URL/,
    );
    assert.doesNotThrow(() => assertDisposableEnvironment({ DATABASE_URL: LOCAL_URL, SUPABASE_DATABASE_URL: PROD_URL }));
  });

  it("also checks MIGRATION_DATABASE_URL, which `prisma migrate deploy` prefers", () => {
    assert.throws(
      () => assertDisposableEnvironment({ DATABASE_URL: LOCAL_URL, MIGRATION_DATABASE_URL: PROD_URL }),
      /MIGRATION_DATABASE_URL/,
    );
  });

  it("does not check a URL that is not set, and honours ALLOW_REMOTE_TEST_DB only for non-production hosts", () => {
    assert.doesNotThrow(() => assertDisposableEnvironment({}));
    assert.doesNotThrow(() =>
      assertDisposableEnvironment({ DATABASE_URL: "postgresql://u:p@dev.example.com/test", ALLOW_REMOTE_TEST_DB: "1" }),
    );
    assert.throws(() => assertDisposableEnvironment({ DATABASE_URL: PROD_URL, ALLOW_REMOTE_TEST_DB: "1" }));
    assert.throws(() => assertDisposableEnvironment({ DATABASE_URL: "postgresql://u:p@dev.example.com/test" }));
  });

  it("assertDisposableRun sees a URL that exists only in .env, as a spawned prisma would", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "disposable-run-"));
    try {
      const dotenv = path.join(dir, ".env");
      writeFileSync(dotenv, `MIGRATION_DATABASE_URL=${PROD_URL}\n`);
      assert.throws(() => assertDisposableRun({ DATABASE_URL: LOCAL_URL }, dotenv), /MIGRATION_DATABASE_URL/);
      // dotenv never overrides a variable that is already set, so neither does this.
      assert.doesNotThrow(() => assertDisposableRun({ DATABASE_URL: LOCAL_URL, MIGRATION_DATABASE_URL: LOCAL_URL }, dotenv));
      // No .env at all is fine.
      assert.doesNotThrow(() => assertDisposableRun({ DATABASE_URL: LOCAL_URL }, path.join(dir, "missing.env")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scripts/check-test-database.mjs and the npm scripts (F-080)", () => {
  function runCheck(env: Record<string, string>) {
    return spawnSync(process.execPath, ["scripts/check-test-database.mjs"], {
      cwd: repoRoot,
      // Only what is given: no ambient DATABASE_URL, and no .env (the script
      // itself does not read one — Node's --env-file does, before it runs).
      env: childEnv(env),
      encoding: "utf8",
    });
  }

  it("exits 1 with an explanation for a remote database, and 0 for a local one", () => {
    const refused = runCheck({ DATABASE_URL: "postgresql://u:secretpw@prod-db.example.invalid:5432/x" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing to run against this database/);
    assert.ok(!refused.stderr.includes("secretpw"));

    assert.equal(runCheck({ DATABASE_URL: LOCAL_URL }).status, 0);
    assert.equal(runCheck({}).status, 0, "nothing configured means nothing to protect");
  });

  it("exits 1 for the swapped-.env incident: DATABASE_URL equal to SUPABASE_DATABASE_URL", () => {
    const result = runCheck({ DATABASE_URL: PROD_URL, SUPABASE_DATABASE_URL: PROD_URL });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /identical to SUPABASE_DATABASE_URL/);
  });

  it("test:unit and test:integration preload the check, and `npm test` runs it first", () => {
    const { scripts } = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };
    for (const name of ["test:unit", "test:integration"]) {
      assert.match(scripts[name], /--env-file-if-exists=\.env --import \.\/scripts\/check-test-database\.mjs --test /, name);
    }
    assert.match(scripts.test, /^node --env-file-if-exists=\.env scripts\/check-test-database\.mjs && npm run test:unit && npm run test:integration$/);
  });

  it("the setup gates and the cleanup scripts use the shared guard", () => {
    assert.match(readRepoFile("scripts/predeploy-verify.mjs"), /assertDisposableRun\(env\)/);
    assert.match(readRepoFile("scripts/verify-101.mjs"), /assertDisposableRun\(env\)/);
    assert.match(readRepoFile("tests/e2e/helpers/rbac-sessions.ts"), /assertDisposableEnvironment\(process\.env\)/);
    for (const file of ["scripts/cleanup-phantom-customers.ts", "scripts/cleanup-orphaned-media.ts"]) {
      assert.match(readRepoFile(file), /assertDisposableDatabase\(databaseUrl,/, file);
    }
  });
});

describe("assert-not-production (F-077)", () => {
  it("recognises the production aliases by host, whatever the scheme, case, slash or port", () => {
    for (const url of [
      "https://storefront-nu-woad.vercel.app",
      "https://Storefront-NU-woad.vercel.app/",
      "http://storefront-varubs-projects.vercel.app:443/shop",
      "https://www.daakyka.com",
      "daakyka.com",
    ]) {
      assert.equal(isProductionTarget(url, {}), true, url);
    }
    assert.ok(KNOWN_PRODUCTION_HOSTS.includes("storefront-nu-woad.vercel.app"));
  });

  it("does not treat a preview deployment, staging host or local server as production", () => {
    for (const url of [
      "https://storefront-abc123xyz-varubs-projects.vercel.app",
      "https://staging.example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]) {
      assert.equal(isProductionTarget(url, {}), false, url);
    }
    assert.equal(isLocalTarget("http://localhost:3300"), true);
    assert.equal(isLocalTarget("http://[::1]:3000"), true);
    assert.equal(isLocalTarget("https://staging.example.com"), false);
  });

  it("refuses a target it cannot parse rather than guessing", () => {
    assert.equal(isProductionTarget("http://", {}), true);
    assert.equal(isProductionTarget("", {}), true);
  });

  it("adds the host of NEXT_PUBLIC_SITE_URL, RELEASE_PUBLIC_URL and PRODUCTION_HOSTS, but not a local site URL", () => {
    const env = {
      NEXT_PUBLIC_SITE_URL: "https://shop.example.org",
      RELEASE_PUBLIC_URL: "https://release.example.org/",
      PRODUCTION_HOSTS: "a.example.org, https://b.example.org/path",
    };
    const hosts = productionHosts(env);
    for (const host of ["shop.example.org", "release.example.org", "a.example.org", "b.example.org"]) {
      assert.ok(hosts.has(host), host);
    }
    assert.equal(productionHosts({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).has("localhost"), false);
  });

  it("productionTargetProblem refuses production for a mutating run and allows it only read-only", () => {
    assert.match(productionTargetProblem("https://storefront-nu-woad.vercel.app", { env: {} }) ?? "", /PRODUCTION store/);
    assert.equal(productionTargetProblem("https://storefront-nu-woad.vercel.app", { readOnly: true, env: {} }), null);
    assert.equal(productionTargetProblem("https://storefront-abc-varubs-projects.vercel.app", { env: {} }), null);
    assert.match(productionTargetProblem(undefined, { env: {} }) ?? "", /no target URL/);
  });

  function runGate(script: string, args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: childEnv(env),
      encoding: "utf8",
      timeout: 30_000,
    });
  }

  it("verify:staging:full has no default target and refuses production before running anything", () => {
    const none = runGate("scripts/verify-staging-full.mjs", [], {});
    assert.equal(none.status, 1);
    assert.match(none.stderr, /deliberately no default/);

    const prod = runGate("scripts/verify-staging-full.mjs", [], { TEST_BASE_URL: "https://storefront-nu-woad.vercel.app/" });
    assert.equal(prod.status, 1);
    assert.match(prod.stderr, /PRODUCTION store/);
    assert.ok(!prod.stdout.includes("==>"), "no stage may have started");
  });

  it("verify:staging refuses production too, since it is what launches the writing suites", () => {
    const targets: Record<string, string>[] = [
      { TEST_BASE_URL: "https://storefront-varubs-projects.vercel.app" },
      { PLAYWRIGHT_BASE_URL: "https://www.daakyka.com" },
    ];
    for (const env of targets) {
      const result = runGate("scripts/verify-staging.mjs", ["--dogfood"], env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /PRODUCTION store/);
      assert.ok(!result.stdout.includes("==>"), "no stage may have started");
    }
  });

  it("the verify-101 stamp no longer falls back to the production URL as a staging URL", () => {
    assert.doesNotMatch(readRepoFile("scripts/verify-101.mjs"), /stagingUrl: process\.env\.STAGING_URL \?\? "https/);
  });
});

describe("probe-deploy (F-076, F-077)", () => {
  const requests: { method: string; path: string }[] = [];
  let studioStatus = 404;

  function respond(request: IncomingMessage, response: ServerResponse) {
    const url = request.url ?? "/";
    requests.push({ method: request.method ?? "GET", path: url });
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url === "/api/health") return json(200, { status: "ok" });
    if (url === "/sitemap.xml") return void response.writeHead(200).end("<urlset>/products/a</urlset>");
    if (url === "/api/admin/blog") return json(401, { error: "Unauthorized" });
    if (url === "/api/auth/login") return json(401, { error: "Invalid credentials" });
    if (url === "/api/hermes/runtime/health") return json(200, { ok: true, service: "daakyka-hermes" });
    if (url === "/api/outfit/try-on") return json(200, { ok: true, resultImageUrl: "https://example.com/x.png" });
    if (url === "/mix-and-match/studio") {
      return void response.writeHead(studioStatus).end(studioStatus === 200 ? "<h1>Virtual Try-On Studio</h1>" : "not found");
    }
    if (url === "/") {
      response.writeHead(200, { "x-frame-options": "DENY", "x-content-type-options": "nosniff" });
      return void response.end('<a href="https://wa.me/1" aria-label="Chat on WhatsApp"></a>');
    }
    return void response.writeHead(200).end("ok");
  }

  const server = createServer(respond);
  const listening = new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function probe(args: string[]) {
    const port = await listening;
    requests.length = 0;
    // Async spawn: the stub server lives in this process, so a synchronous
    // child would block the event loop it needs to answer on.
    return new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, ["scripts/probe-deploy.mjs", ...args], {
        cwd: repoRoot,
        env: childEnv({ TEST_BASE_URL: `http://127.0.0.1:${port}` }),
      });
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
      child.stderr.on("data", (chunk: Buffer) => (stdout += chunk));
      child.on("close", (status) => resolve({ status, stdout }));
    });
  }

  it("passes against a default install whose optional studio page is switched off (404), and makes no write request", async () => {
    studioStatus = 404;
    const result = await probe([]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /studio is switched off/);
    assert.ok(!requests.some((r) => r.path === "/api/outfit/try-on"), "the try-on POST must be opt-in");
  });

  it("still checks the studio heading when the page is enabled", async () => {
    studioStatus = 200;
    const result = await probe([]);
    assert.equal(result.status, 0, result.stdout);
    studioStatus = 404;
  });

  it("--write-probes adds the try-on POST", async () => {
    studioStatus = 404;
    const result = await probe(["--write-probes"]);
    assert.equal(result.status, 0, result.stdout);
    assert.ok(requests.some((r) => r.method === "POST" && r.path === "/api/outfit/try-on"));
  });
});

describe("Playwright env loading and CI wiring (F-252, F-249, F-076)", () => {
  it("playwright.config.ts loads .env the way the tsx test scripts do", () => {
    assert.match(readRepoFile("playwright.config.ts"), /existsSync\("\.env"\)\) process\.loadEnvFile\("\.env"\)/);
  });

  it("the admin specs resolve credentials per login, not at module scope", () => {
    for (const file of ["tests/e2e/admin.spec.ts", "tests/e2e/dogfood.spec.ts"]) {
      const source = readRepoFile(file);
      assert.doesNotMatch(source, /^const \{[^}]*\} = resolveAdminCredentials\(\);/m, file);
      assert.match(source, /async function loginAsAdmin/, file);
    }
  });

  it("the CI workflow supplies a CREDENTIAL_ENCRYPTION_KEY that decodes to exactly 32 bytes", () => {
    const match = readRepoFile(".github/workflows/storefront-verify.yml").match(/^ {2}CREDENTIAL_ENCRYPTION_KEY: (\S+)$/m);
    assert.ok(match, "the workflow's top-level env must set CREDENTIAL_ENCRYPTION_KEY");
    assert.equal(Buffer.from(match[1], "base64").length, 32);
  });

  it("the CI e2e job publishes the seeded catalogue the browser specs need", () => {
    assert.match(readRepoFile(".github/workflows/storefront-verify.yml"), /npm run db:seed:catalog -- --publish/);
  });
});
