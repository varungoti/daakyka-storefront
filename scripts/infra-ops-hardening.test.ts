import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ensurePortFree,
  parseNetstatListeners,
  wantsKillPort,
} from "./lib/kill-port.mjs";
import {
  MIN_API_KEY_LENGTH,
  TARGET as WIRE_TARGET,
  apiKeyProblem,
  buildVercelDeployArgs,
  buildVercelEnvAddArgs as buildWireEnvAddArgs,
  parseTunnelUrl,
} from "./wire-ar-staging.mjs";
import {
  SECRET_KEYS,
  TARGET as BOOTSTRAP_TARGET,
  applyPlan,
  buildVercelEnvAddArgs as buildBootstrapEnvAddArgs,
  generateStagingEnv,
  readAdminEmail,
  renderEnvLines,
} from "./bootstrap-staging.mjs";

/**
 * Static and pure checks for the infra/ops hardening package (F-075, F-078,
 * F-304, F-308, F-309, F-310, F-234, F-319): CI workflow hygiene, the Vercel
 * function region, the operator scripts' guard rails, .gitignore ordering and
 * the public security contact. No network, no Docker, no git, no database.
 */

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Source with // and block comments removed, so prose can't trip a code assertion. */
function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("GitHub workflows (F-075, F-308)", () => {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const workflows = fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));

  it("finds both workflow files", () => {
    assert.ok(workflows.includes("storefront-verify.yml"));
    assert.ok(workflows.includes("deploy-ar-tryon.yml"));
  });

  for (const name of workflows) {
    const text = read(path.join(".github", "workflows", name));

    it(`${name}: declares least-privilege permissions at the top level`, () => {
      assert.match(text, /^permissions:\n {2}contents: read$/m);
    });

    it(`${name}: pins every third-party action to a full commit SHA`, () => {
      const refs = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
      assert.ok(refs.length > 0);
      for (const ref of refs) {
        if (ref.startsWith("./")) continue;
        const version = ref.split("@")[1] ?? "";
        assert.match(version, /^[0-9a-f]{40}$/, `${ref} is not pinned by SHA`);
      }
    });

    it(`${name}: checkout never persists the GITHUB_TOKEN`, () => {
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (!/uses:\s*actions\/checkout@/.test(line)) return;
        const following = lines.slice(index + 1, index + 8).join("\n");
        assert.match(following, /persist-credentials:\s*false/, `checkout at line ${index + 1}`);
      });
    });

    it(`${name}: never uses the secrets context inside an if: (invalid, fails the whole file)`, () => {
      for (const line of text.split("\n")) {
        if (/^\s*(-\s+)?if:/.test(line)) {
          assert.ok(!/secrets\./.test(line), `invalid if: ${line.trim()}`);
        }
      }
    });
  }

  it("storefront-verify runs for release branches, not only main/master/staging", () => {
    const text = read(".github/workflows/storefront-verify.yml");
    assert.match(text, /push:\n {4}branches: \[[^\]]*"release-\*"/);
    assert.match(text, /pull_request:\n {4}branches: \[[^\]]*"release-\*"/);
  });

  it("the live probe no longer hard-codes production with --staging", () => {
    const text = read(".github/workflows/storefront-verify.yml");
    assert.ok(!/storefront-nu-woad\.vercel\.app/.test(text));
    assert.match(text, /probe_base_url/);
    // The flag is only ever passed when the (opt-in) boolean input is set.
    assert.match(text, /PROBE_EXPECTS_NOINDEX/);
  });

  it("the Railway CLI that receives RAILWAY_TOKEN is pinned to an exact version", () => {
    const text = read(".github/workflows/deploy-ar-tryon.yml");
    assert.match(text, /npm install -g @railway\/cli@\d+\.\d+\.\d+\b/);
    assert.ok(!/@railway\/cli(\s|$)/.test(text.replace(/@railway\/cli@\d+\.\d+\.\d+/g, "")));
  });

  it("Dependabot keeps the pinned actions current", () => {
    const text = read(".github/dependabot.yml");
    assert.match(text, /package-ecosystem:\s*github-actions/);
  });
});

describe("vercel.json (F-078)", () => {
  it("pins functions to a single region next to the Tokyo database", () => {
    // The production Supabase project is in ap-northeast-1 (Tokyo), so the
    // functions belong in hnd1. Running them in iad1 cost ~150 ms per query and
    // an extra ~220 ms hop on every dynamic page. If the database moves to
    // ap-south-1, change this to ["bom1"] in the same commit as the move.
    const config = JSON.parse(read("vercel.json"));
    assert.deepEqual(config.regions, ["hnd1"]);
  });

  it("still lists the cron jobs and function durations", () => {
    const config = JSON.parse(read("vercel.json"));
    assert.ok(Array.isArray(config.crons) && config.crons.length > 0);
    assert.ok(config.functions && Object.keys(config.functions).length > 0);
  });
});

describe("kill-port helpers (F-309)", () => {
  const NETSTAT = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       111",
    "  TCP    [::]:3000              [::]:0                 LISTENING       111",
    "  TCP    127.0.0.1:3000         127.0.0.1:51000        ESTABLISHED     111",
    "  TCP    127.0.0.1:51000        127.0.0.1:3000         ESTABLISHED     222",
    "  TCP    127.0.0.1:30000        0.0.0.0:0              LISTENING       333",
    "  TCP    0.0.0.0:13000          0.0.0.0:0              LISTENING       444",
    "  TCP    192.168.1.5:50234      142.250.0.1:3000       ESTABLISHED     555",
    "  TCP    127.0.0.1:3000         127.0.0.1:51001        TIME_WAIT       0",
    "  UDP    0.0.0.0:3000           *:*                                    666",
  ].join("\r\n");

  it("returns only processes LISTENING on exactly the requested port", () => {
    assert.deepEqual(parseNetstatListeners(NETSTAT, 3000), [111]);
  });

  it("does not match longer ports that merely contain the number", () => {
    assert.deepEqual(parseNetstatListeners(NETSTAT, 30000), [333]);
    assert.deepEqual(parseNetstatListeners(NETSTAT, 3000).includes(333), false);
  });

  it("ignores client sockets whose REMOTE port is the target (browsers, this script)", () => {
    const pids = parseNetstatListeners(NETSTAT, 3000);
    assert.ok(!pids.includes(222));
    assert.ok(!pids.includes(555));
  });

  it("recognises a listener on a non-English Windows by its :0 foreign address", () => {
    const localised = "  TCP    0.0.0.0:3000           0.0.0.0:0              ABHÖREN       777";
    assert.deepEqual(parseNetstatListeners(localised, 3000), [777]);
  });

  it("returns nothing for empty or unrelated output", () => {
    assert.deepEqual(parseNetstatListeners("", 3000), []);
    assert.deepEqual(parseNetstatListeners("garbage\nlines", 3000), []);
  });

  it("ensurePortFree refuses, and kills nothing, without the explicit opt-in", () => {
    const killed: number[][] = [];
    assert.throws(
      () => ensurePortFree(3000, { find: () => [4242], kill: (pids: number[]) => killed.push(pids) }),
      /already in use by process 4242[\s\S]*--kill-port/,
    );
    assert.deepEqual(killed, []);
  });

  it("ensurePortFree kills the listener only when allowed, and is a no-op on a free port", () => {
    const killed: number[][] = [];
    ensurePortFree(3000, { allowKill: true, find: () => [4242], kill: (pids: number[]) => killed.push(pids) });
    assert.deepEqual(killed, [[4242]]);
    ensurePortFree(3000, { find: () => [], kill: (pids: number[]) => killed.push(pids) });
    assert.equal(killed.length, 1);
  });

  it("wantsKillPort reads the flag or KILL_PORT=1 and nothing else", () => {
    assert.equal(wantsKillPort(["node", "x.mjs", "--kill-port"], {}), true);
    assert.equal(wantsKillPort(["node", "x.mjs"], { KILL_PORT: "1" }), true);
    assert.equal(wantsKillPort(["node", "x.mjs"], { KILL_PORT: "0" }), false);
    assert.equal(wantsKillPort(["node", "x.mjs"], {}), false);
  });

  it("the verify scripts use the shared helper and no longer shell out to findstr/taskkill", () => {
    for (const file of ["scripts/predeploy-verify.mjs", "scripts/verify-101.mjs"]) {
      const code = stripJsComments(read(file));
      assert.match(code, /from "\.\/lib\/kill-port\.mjs"/, file);
      assert.ok(!/findstr|taskkill|xargs kill/.test(code), `${file} still force-kills by substring`);
    }
  });
});

describe("wire-ar-staging (F-304)", () => {
  it("only ever targets the Vercel preview environment", () => {
    assert.equal(WIRE_TARGET, "preview");
    assert.deepEqual(buildWireEnvAddArgs("AR_TRYON_SERVICE_URL"), [
      "vercel",
      "env",
      "add",
      "AR_TRYON_SERVICE_URL",
      "preview",
      "--force",
    ]);
  });

  it("never builds a production env write or a --prod deploy", () => {
    const argv = [...buildWireEnvAddArgs("AR_TRYON_API_KEY"), ...buildVercelDeployArgs()];
    assert.ok(!argv.includes("production"));
    assert.ok(!argv.includes("--prod"));
    const code = stripJsComments(read("scripts/wire-ar-staging.mjs"));
    assert.ok(!/["'`]production["'`]/.test(code), "the script's code must not name the production environment");
    assert.ok(!/--prod\b/.test(code));
  });

  it("does not download or run an unpinned binary through a shell", () => {
    const code = stripJsComments(read("scripts/wire-ar-staging.mjs"));
    assert.ok(!/releases\/latest/.test(code));
    assert.ok(!/writeFile/.test(code));
    // The only shell:true spawns are the npx ones (npx is npx.cmd on Windows).
    const shellSpawns = code.match(/shell:\s*true/g) ?? [];
    const npxSpawns = code.match(/spawnSync\("npx"/g) ?? [];
    assert.equal(shellSpawns.length, npxSpawns.length);
  });

  it("does not treat 'already exists' as success", () => {
    assert.ok(!/already exists/.test(stripJsComments(read("scripts/wire-ar-staging.mjs"))));
  });

  it("refuses to expose the service without a long enough API key", () => {
    assert.match(String(apiKeyProblem(undefined)), /not set/);
    assert.match(String(apiKeyProblem("short")), /too short/);
    assert.equal(apiKeyProblem("k".repeat(MIN_API_KEY_LENGTH)), null);
  });

  it("extracts the quick-tunnel URL from cloudflared output", () => {
    assert.equal(
      parseTunnelUrl("2026-10-02 INF |  https://quiet-river-1234.trycloudflare.com  |"),
      "https://quiet-river-1234.trycloudflare.com",
    );
    assert.equal(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com..."), null);
  });
});

describe("bootstrap-staging (F-309)", () => {
  const fixedRandom = (size: number) => Buffer.alloc(size, 0xab);

  it("only ever targets the Vercel preview environment", () => {
    assert.equal(BOOTSTRAP_TARGET, "preview");
    assert.ok(!buildBootstrapEnvAddArgs("AUTH_SECRET").includes("production"));
  });

  it("does not hard-code a personal admin email", () => {
    assert.ok(!/varungoti/i.test(read("scripts/bootstrap-staging.mjs")));
    const env = generateStagingEnv({ random: fixedRandom });
    assert.ok(!/@/.test(env.ADMIN_SEED_EMAIL), "without --admin-email the value is a placeholder");
    assert.equal(generateStagingEnv({ adminEmail: "owner@example.com", random: fixedRandom }).ADMIN_SEED_EMAIL, "owner@example.com");
  });

  it("reads the admin email from the flag or the environment", () => {
    assert.equal(readAdminEmail(["--admin-email=a@b.co"], {}), "a@b.co");
    assert.equal(readAdminEmail([], { ADMIN_SEED_EMAIL: " c@d.co " }), "c@d.co");
    assert.equal(readAdminEmail([], {}), null);
  });

  it("masks the generated secrets unless asked to reveal them", () => {
    const env = generateStagingEnv({ adminEmail: "owner@example.com", random: fixedRandom });
    const masked = renderEnvLines(env).join("\n");
    for (const key of SECRET_KEYS) {
      assert.ok(!masked.includes(env[key as keyof typeof env]), `${key} leaked into the default output`);
    }
    const revealed = renderEnvLines(env, { reveal: true }).join("\n");
    for (const key of SECRET_KEYS) {
      assert.ok(revealed.includes(env[key as keyof typeof env]));
    }
  });

  it("--apply pushes the secrets (and the admin email when given), and nothing placeholder-valued", () => {
    const env = generateStagingEnv({ adminEmail: "owner@example.com", random: fixedRandom });
    assert.deepEqual(
      applyPlan(env, "owner@example.com").map((item) => item.name),
      ["AUTH_SECRET", "CRON_SECRET", "ADMIN_SEED_PASSWORD", "ADMIN_SEED_EMAIL"],
    );
    assert.ok(!applyPlan(env, null).some((item) => item.name === "DATABASE_URL"));
  });

  it("no longer tells the operator to create a Neon database", () => {
    assert.ok(!/Create Neon/.test(read("scripts/bootstrap-staging.mjs")));
  });
});

describe("go-live smoke check (F-309)", () => {
  it("aborts when the homepage lacks the brand marker instead of warning", () => {
    const code = stripJsComments(read("scripts/go-live.mjs"));
    assert.match(code, /if \(!\/DAAKYKA\/i\.test\(homepageHtml\)\) \{\s*die\(/);
    assert.ok(!/WARNING: response did not contain 'DAAKYKA'/.test(code));
  });

  it("fetches without following redirects, so a Vercel login page can't pass", () => {
    const code = stripJsComments(read("scripts/go-live.mjs"));
    assert.match(code, /redirect:\s*"manual"/);
  });
});

describe("push-env DATABASE_URL replacement (F-309)", () => {
  it("upserts with --force and never removes a variable before re-adding it", () => {
    const code = stripJsComments(read("scripts/push-env-to-vercel.mjs"));
    assert.match(code, /"--force"/);
    assert.ok(!/"env",\s*"rm"/.test(code), "an rm-then-add window would leave production without DATABASE_URL");
  });
});

describe(".gitignore (F-310)", () => {
  it("the *.example negation comes after every broader .env rule, so templates stay committable", () => {
    const rules = read(".gitignore")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const negation = rules.lastIndexOf("!.env*.example");
    const lastBroadEnvRule = rules.reduce(
      (last, rule, index) => (/^\.env/.test(rule) ? index : last),
      -1,
    );
    assert.ok(negation >= 0, "expected a !.env*.example rule");
    assert.ok(negation > lastBroadEnvRule, "a later .env* rule would re-ignore the templates");
  });

  it("still ignores real env files", () => {
    const rules = read(".gitignore").split("\n").map((line) => line.trim());
    assert.ok(rules.includes(".env*"));
  });
});

describe("security.txt (F-319)", () => {
  const text = read("public/.well-known/security.txt");

  it("names a contact", () => {
    assert.match(text, /^Contact: (mailto:\S+@\S+|https:\/\/\S+)$/m);
  });

  it("has a parseable ISO-8601 Expires date (RFC 9116)", () => {
    const expires = text.match(/^Expires: (\S+)$/m)?.[1];
    assert.ok(expires, "Expires is required by RFC 9116");
    assert.ok(!Number.isNaN(Date.parse(expires)), `unparseable Expires: ${expires}`);
  });
});

describe("incident-response documentation (F-319, F-234)", () => {
  it("covers CERT-In's 6-hour report, the DPDP 72-hour report and 180-day log retention", () => {
    const doc = read("docs/INCIDENT_RESPONSE.md");
    assert.match(doc, /CERT-In/);
    assert.match(doc, /6 hours/);
    assert.match(doc, /72 hours/);
    assert.match(doc, /180 days/);
  });

  it("the go-live runbook documents rollback, backups and monitoring", () => {
    const doc = read("docs/GO_LIVE_RUNBOOK.md");
    assert.match(doc, /## Rolling back a bad deploy/);
    assert.match(doc, /## Backups & restore/);
    assert.match(doc, /## Monitoring & alerting/);
  });
});
