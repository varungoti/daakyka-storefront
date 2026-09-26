import { readFileSync } from "node:fs";

/**
 * Minimal .env reader shared by the deploy scripts.
 *
 * Deliberately not `dotenv`: these scripts decide what reaches production,
 * so the parse must be explicit and stable rather than a function of
 * whichever dotenv version happens to be installed. It does reproduce
 * dotenv's one surprising behaviour — an unquoted `#` starts an inline
 * comment — because that is what the running app will see. (That rule
 * silently truncated ADMIN_SEED_PASSWORD from 14 chars to 10 and made a
 * correct password look wrong.)
 */
export function readEnvFile(path = ".env") {
  const out = new Map();
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read ${path} — run this from the storefront/ directory.`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // F-347 fix: a quoted value's closing quote is the FIRST matching quote
    // character after the opening one, not necessarily the last character
    // on the line. The previous `startsWith(...) && endsWith(...)` check
    // only matched a quoted value with nothing after its closing quote —
    // any inline comment after a quoted value (`KEY="value" # comment`)
    // made `endsWith` fail, fell through to the comment-stripping branch
    // below, and left the leading quote character in the value untouched
    // (dotenv, which the app itself uses to load .env, strips it). That
    // put literal quote characters into secrets pushed to production.
    const quoted = value.match(/^(["'])([\s\S]*?)\1(?:\s*#.*)?$/);
    if (quoted) {
      value = quoted[2];
    } else {
      const hash = value.indexOf("#");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (value) out.set(key, value);
  }
  return out;
}
