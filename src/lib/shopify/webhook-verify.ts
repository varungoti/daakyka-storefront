import { createHmac, timingSafeEqual } from "crypto";

export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    return process.env.NODE_ENV === "development";
  }

  if (!hmacHeader) {
    return false;
  }

  const digest = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}
