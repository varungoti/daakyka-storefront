import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * F-306: docker-compose.yml used to publish Hermes, Postgres (with its
 * default password) and the AR try-on service on 0.0.0.0 — every
 * interface, including the LAN, not just this machine's loopback. Every
 * `ports:` entry must now bind explicitly to a host IP (the
 * "HOST_IP:HOST_PORT:CONTAINER_PORT" form) rather than the bare
 * "HOST_PORT:CONTAINER_PORT" short form, which Docker publishes on
 * 0.0.0.0. A mapping is still allowed to bind 0.0.0.0 (or omit the host
 * IP) when the line carries an explicit `# lan-required:` comment
 * explaining why — this test is a regression guard against an
 * *accidental* re-widening, not a hard ban.
 */
function readComposeFile(): string {
  const composePath = path.join(process.cwd(), "docker-compose.yml");
  return fs.readFileSync(composePath, "utf8");
}

/** Extracts every `- "..."` / `- ...` ports-list item, alongside the raw
 * line it appeared on (for the `# lan-required:` opt-out check) and
 * whether the previous non-blank line carries that opt-out too. */
function extractPortMappings(composeText: string): { mapping: string; hasOptOut: boolean }[] {
  const lines = composeText.split(/\r?\n/);
  const results: { mapping: string; hasOptOut: boolean }[] = [];
  let inPorts = false;
  let lastNonBlankLine = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (/^ports:\s*$/.test(trimmed)) {
      inPorts = true;
      lastNonBlankLine = line;
      continue;
    }

    if (inPorts) {
      const item = trimmed.match(/^-\s*"?([^"#]+)"?\s*(#.*)?$/);
      if (item) {
        const mapping = item[1].trim();
        const ownComment = line.includes("#") ? line : "";
        const hasOptOut = /#\s*lan-required:/.test(ownComment) || /#\s*lan-required:/.test(lastNonBlankLine);
        results.push({ mapping, hasOptOut });
        lastNonBlankLine = line;
        continue;
      }
      // Any other top-level (non "- ") key ends this service's ports list.
      if (!trimmed.startsWith("-")) {
        inPorts = false;
      }
    }
    lastNonBlankLine = line;
  }

  return results;
}

describe("docker-compose.yml port bindings", () => {
  it("finds at least one port mapping (sanity check for the parser above)", () => {
    const mappings = extractPortMappings(readComposeFile());
    assert.ok(mappings.length > 0, "expected docker-compose.yml to declare at least one published port");
  });

  it("never publishes a port on every interface without an explicit lan-required opt-out", () => {
    const mappings = extractPortMappings(readComposeFile());
    const offenders = mappings.filter(({ mapping, hasOptOut }) => {
      if (hasOptOut) return false;
      const parts = mapping.split(":");
      // Bare "HOST_PORT:CONTAINER_PORT" (2 parts) publishes on 0.0.0.0;
      // an explicit "0.0.0.0:HOST_PORT:CONTAINER_PORT" does too.
      return parts.length < 3 || parts[0] === "0.0.0.0";
    });
    assert.deepEqual(
      offenders.map((o) => o.mapping),
      [],
      "found a port mapping that publishes on every interface — bind to 127.0.0.1 (or add a `# lan-required:` comment explaining why not)",
    );
  });
});
