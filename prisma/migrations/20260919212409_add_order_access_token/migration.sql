-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accessTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");
