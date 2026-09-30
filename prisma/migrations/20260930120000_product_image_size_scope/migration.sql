-- Existing images remain unverified for size applicability until an admin
-- assigns an exact size or confirms that the same design applies to all sizes.
ALTER TABLE "ProductImage"
  ADD COLUMN "size" TEXT,
  ADD COLUMN "appliesToAllSizes" BOOLEAN NOT NULL DEFAULT false;
