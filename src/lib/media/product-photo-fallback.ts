// These are the immutable-name WebP product assets emitted by the existing
// uploads pipeline. No query parameters, remote origins, or other /cdn paths.
const GENERATED_PRODUCT_PHOTO =
  /^\/cdn\/media\/product\/\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

export function isGeneratedProductPhoto(source: string): boolean {
  return GENERATED_PRODUCT_PHOTO.test(source);
}

/** Only retry a failed optimizer request for this exact image. */
export function wasProductOptimizerRequest(url: string, origin: string, source: string): boolean {
  if (!isGeneratedProductPhoto(source)) return false;
  try {
    const request = new URL(url, origin);
    return request.origin === origin
      && request.pathname === "/_next/image"
      && request.searchParams.getAll("url").length === 1
      && request.searchParams.get("url") === source;
  } catch {
    return false;
  }
}
