/**
 * Cloudflare R2 object storage (S3-compatible API).
 *
 * Server-only: never import this from a client component. Credentials are
 * read from process.env at call time (never cached into a committed file,
 * never logged) so the module loads fine even when R2 isn't configured yet
 * — callers must check `isR2Configured()` first and handle the "not
 * configured" case gracefully (see StorageNotConfiguredError below).
 */
import https from "node:https";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { readR2Env, type R2Env } from "./r2-env";

export class StorageNotConfiguredError extends Error {
  constructor(message = "Cloudflare R2 storage is not configured") {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

// Env resolution (R2_* with CLOUDFLARE_* fallbacks) lives in ./r2-env so
// src/lib/env.ts's boot-time check can share it without importing the S3 SDK.
// The boot-time warning and this check therefore can never disagree (F-237).
export function isR2Configured(): boolean {
  return readR2Env() !== null;
}

/**
 * F-302: local dev, the localhost audit build, and every script/test that
 * isn't the real Vercel production deployment can end up with `R2_BUCKET`
 * (or the `CLOUDFLARE_*` fallbacks) pointing at the actual production
 * bucket — see docs/GO_LIVE_RUNBOOK.md/docs/HANDOVER.md, which name only
 * one bucket, `daakyka-media`. Nothing before this stopped a local admin
 * session's slot-replace (`deleteObject`), or the orphan-cleanup script
 * sweeping rows that are only orphaned in the *local* DB, from deleting
 * real production media. `R2_PRODUCTION_BUCKET` lets the bucket's name be
 * configured rather than hard-coded, but defaults to the one bucket this
 * deployment actually has.
 */
function productionBucketName(): string {
  return process.env.R2_PRODUCTION_BUCKET ?? "daakyka-media";
}

export class ProductionBucketWriteBlockedError extends Error {
  constructor(bucket: string) {
    super(
      `Refusing to write to or delete from R2 bucket "${bucket}" from a non-production environment ` +
        `(VERCEL_ENV is not "production"). Point R2_BUCKET/CLOUDFLARE_* at a separate dev/test bucket, ` +
        `or set R2_ALLOW_PROD_BUCKET_WRITES=1 for a deliberate one-off (e.g. an intentional prod image backfill).`,
    );
    this.name = "ProductionBucketWriteBlockedError";
  }
}

/**
 * Called by every write/delete below, never by `getObject` — a stale read
 * against the production bucket from a dev build isn't a data-loss risk,
 * only a write or a delete is. Keyed on `VERCEL_ENV`, deliberately not
 * `NODE_ENV`: the local audit build runs `next start`, which sets
 * `NODE_ENV=production` even though it's nowhere near the real deployment.
 */
export function assertBucketIsWritable(bucket: string): void {
  const isRealProductionDeploy = process.env.VERCEL_ENV === "production";
  const explicitlyAllowed = process.env.R2_ALLOW_PROD_BUCKET_WRITES === "1";
  if (!isRealProductionDeploy && !explicitlyAllowed && bucket === productionBucketName()) {
    throw new ProductionBucketWriteBlockedError(bucket);
  }
}

// Cached per accountId/accessKeyId pair so a changed env (e.g. between
// test cases using withEnv) doesn't reuse a stale client.
let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

function getClient(env: R2Env): S3Client {
  const key = `${env.accountId}:${env.accessKeyId}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new S3Client({
      region: "auto",
      // Always derive the endpoint from the account id rather than trusting
      // a separately-configured endpoint env var — the two can drift out
      // of sync (observed in practice: an updated account id with a stale
      // endpoint value silently pointed requests at the wrong account).
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
      // The AWS SDK's default Node request handler negotiates a TLS
      // handshake that this environment's network path hard-rejects
      // against R2's endpoint (confirmed: plain `https.request` and
      // PowerShell's .NET TLS stack both connect fine against the same
      // host/port, but the SDK's own handler fails before a certificate is
      // even exchanged). Forcing a plain `https.Agent` with Node's default
      // TLS options sidesteps whatever the SDK handler sets that trips
      // this — verified working for HeadBucket/PutObject/GetObject/
      // DeleteObject against the real endpoint.
      requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true }) }),
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

function requireEnv(): R2Env {
  const env = readR2Env();
  if (!env) throw new StorageNotConfiguredError();
  return env;
}

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const env = requireEnv();
  assertBucketIsWritable(env.bucket);
  await getClient(env).send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  etag?: string;
}

/** Returns null when the key doesn't exist, so the caller (the /cdn media
 * route) can 404 cleanly instead of surfacing an R2/SDK error. */
export async function getObject(key: string): Promise<StoredObject | null> {
  const env = requireEnv();
  try {
    const result = await getClient(env).send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    if (!result.Body) return null;
    return {
      body: result.Body.transformToWebStream(),
      contentType: result.ContentType ?? "application/octet-stream",
      contentLength: result.ContentLength,
      etag: result.ETag,
    };
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const env = requireEnv();
  assertBucketIsWritable(env.bucket);
  await getClient(env).send(
    new DeleteObjectCommand({ Bucket: env.bucket, Key: key }),
  );
}

/**
 * A presigned direct-to-R2 upload URL. Not currently wired to an admin API
 * route — see the doc comment on the multipart upload route
 * (src/app/api/admin/media/route.ts) for why direct server-side upload is
 * used instead for now. Kept here as a complete, tested building block of
 * the storage lib for a future client-side-upload flow (e.g. very large
 * files that shouldn't transit the Next.js server function).
 *
 * Note: an S3 presigned PUT URL cannot itself cap the uploaded byte count
 * (that requires a presigned POST policy with content-length-range); a
 * caller relying on `maxBytes` for enforcement must still verify the
 * object's actual size after upload (e.g. via HeadObject) before trusting
 * it.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  maxBytes: number,
  expiresSeconds = 300,
): Promise<string> {
  const env = requireEnv();
  assertBucketIsWritable(env.bucket);
  void maxBytes; // documented caveat above — not enforced by the presigned URL itself
  const command = new PutObjectCommand({
    Bucket: env.bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(env), command, { expiresIn: expiresSeconds });
}

/**
 * The bucket has no public-read access configured (no r2.dev subdomain or
 * custom domain enabled) — R2_PUBLIC_BASE_URL, when set, is the fast path
 * (served directly from Cloudflare's edge). Without it, every image is
 * served through this app's own `/cdn/[...key]` route instead, which
 * authenticates to R2 server-side via `getObject()`. This keeps the
 * bucket private and needs no further Cloudflare dashboard step.
 */
export function publicUrlForKey(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, "")}/${key}`;
  }
  return `/cdn/${key}`;
}
