/**
 * The one place that decides whether Cloudflare R2 is configured.
 *
 * Deliberately dependency-free: src/lib/env.ts (which next.config.ts imports
 * through its own transpile pipeline, with no tsconfig path aliases) needs
 * this answer at boot, and importing src/lib/storage/r2.ts for it would drag
 * the whole S3 SDK into the config load. Before this was shared, env.ts kept
 * its own copy of the alias list and warned "R2 storage is not fully
 * configured ... uploads will report as not configured" on production builds
 * where uploads were working fine (F-237) -- the two copies had drifted.
 */

export interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

// Accepts CLOUDFLARE_* names as a fallback to R2_* — this deployment's
// .env was populated under the Cloudflare-prefixed names (account
// dashboard convention) rather than this app's own R2_* convention.
// R2_PUBLIC_BASE_URL is intentionally NOT part of this: the bucket is
// private and media is served same-origin through /cdn/[...key].
export function readR2Env(env: NodeJS.ProcessEnv = process.env): R2Env | null {
  const accountId = env.R2_ACCOUNT_ID ?? env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? env.CLOUDFLARE_ACCESS_KEY_ID ?? env.CLOUDFLARE_ACCESS_KEY;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2EnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readR2Env(env) !== null;
}
