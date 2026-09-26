import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile } from "./read-env-file.mjs";

/**
 * F-347 regression: readEnvFile() must match dotenv's own parsing exactly
 * for quoted values, including when an inline comment follows the closing
 * quote — see the fix comment in read-env-file.mjs. Cases here mirror the
 * ones the audit reproduced (logs/../parsecheck) comparing this parser
 * against dotenv 17.4.2, which the app itself loads .env with.
 */
function withTempEnvFile(contents: string, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "read-env-file-test-"));
  const path = join(dir, ".env");
  writeFileSync(path, contents, "utf8");
  try {
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readEnvFile quoted values (F-347)", () => {
  it("strips a double-quoted value with no trailing comment", () => {
    withTempEnvFile('KEY="plain-value"\n', (path) => {
      assert.equal(readEnvFile(path).get("KEY"), "plain-value");
    });
  });

  it("strips a double-quoted value followed by an inline comment", () => {
    withTempEnvFile('OPENAI_API_KEY="sk-abcdefghij1234567890"   # personal key\n', (path) => {
      assert.equal(readEnvFile(path).get("OPENAI_API_KEY"), "sk-abcdefghij1234567890");
    });
  });

  it("strips a single-quoted value followed by an inline comment", () => {
    withTempEnvFile("SINGLE='x' # note\n", (path) => {
      assert.equal(readEnvFile(path).get("SINGLE"), "x");
    });
  });

  it("keeps a '#' inside a quoted value intact even with a trailing comment", () => {
    withTempEnvFile('ADMIN_SEED_PASSWORD="abc#defghijklm" # note\n', (path) => {
      assert.equal(readEnvFile(path).get("ADMIN_SEED_PASSWORD"), "abc#defghijklm");
    });
  });

  it("keeps a quoted URL with special characters intact, with a trailing comment", () => {
    withTempEnvFile(
      'SUPABASE_DATABASE_URL="postgresql://u:p@host:5432/db" # prod session pooler\n',
      (path) => {
        assert.equal(
          readEnvFile(path).get("SUPABASE_DATABASE_URL"),
          "postgresql://u:p@host:5432/db",
        );
      },
    );
  });

  it("still truncates an unquoted value at an inline '#' (dotenv parity)", () => {
    withTempEnvFile("ADMIN_SEED_PASSWORD=abc#defghijklm\n", (path) => {
      assert.equal(readEnvFile(path).get("ADMIN_SEED_PASSWORD"), "abc");
    });
  });

  it("does not treat a quote character inside an unquoted value as a delimiter", () => {
    withTempEnvFile("KEY=no'quotes\"here\n", (path) => {
      assert.equal(readEnvFile(path).get("KEY"), "no'quotes\"here");
    });
  });
});
