import { db } from "@/lib/db";
import { findProductImageCoverageGaps, findVerifiedSizeImageCoverageGaps, REQUIRED_IMAGES_PER_COLORWAY } from "@/lib/catalog/product-image-coverage";

async function main() {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    select: {
      slug: true,
      name: true,
      variants: { select: { size: true, color: true, active: true } },
      images: { select: { mediaId: true, color: true, size: true, appliesToAllSizes: true } },
    },
  });
  const gaps = findProductImageCoverageGaps(products);
  const sizeGaps = findVerifiedSizeImageCoverageGaps(products);
  const missing = gaps.reduce((sum, gap) => sum + gap.missing, 0);
  const affectedVariants = gaps.reduce((sum, gap) => sum + gap.sizes.length, 0);
  const listedSizeVariants = products.reduce(
    (sum, product) => sum + product.variants.filter((variant) => variant.active).length,
    0,
  );
  console.log(JSON.stringify({
    requiredImagesPerColorway: REQUIRED_IMAGES_PER_COLORWAY,
    sizeSpecificCoverageVerified: sizeGaps.length === 0,
    listedSizeVariants,
    activeProducts: products.length,
    affectedColorways: gaps.length,
    affectedVariants,
    missingDistinctImages: missing,
    affectedSizeVariants: sizeGaps.length,
    missingVerifiedSizeImageSlots: sizeGaps.reduce((sum, gap) => sum + gap.missing, 0),
    gaps,
    ...(process.argv.includes("--details") ? { sizeGaps } : {}),
  }, null, 2));
  if (gaps.length > 0 || sizeGaps.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
