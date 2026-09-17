/**
 * `@types/node` marks `process.env.NODE_ENV` as `readonly`, so a direct
 * `process.env.NODE_ENV = "..."` assignment fails type-checking (TS2540)
 * even though it works fine at runtime. Tests that need to flip NODE_ENV
 * to exercise production/development-only code paths should go through
 * these helpers instead of assigning the property directly.
 *
 * `Object.assign`/`Reflect.deleteProperty` mutate the same object but are
 * ordinary function calls, not assignment expressions, so TypeScript's
 * readonly check doesn't apply to them.
 */
export function setNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    Object.assign(process.env, { NODE_ENV: value });
  }
}

/** Sets (or deletes, when the value is `undefined`) one or more env vars. */
export function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (key === "NODE_ENV") {
      setNodeEnv(value);
      continue;
    }
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Runs `fn` with the given env vars set, then restores every var
 * (including `NODE_ENV`) to its prior value afterwards, even if `fn`
 * throws.
 */
export async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    originals[key] = process.env[key];
  }
  setEnv(vars);
  try {
    return await fn();
  } finally {
    setEnv(originals);
  }
}
