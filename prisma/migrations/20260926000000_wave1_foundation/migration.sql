-- release-hardening schema-foundation (wave 1 batch 1a)
-- Additive-only: nullable/defaulted columns, new nullable/unique indexes, one
-- new lightweight table, and two enum-value additions. No renames or drops,
-- so this is safe to deploy ahead of the code that starts reading/writing
-- the new columns.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

-- AlterEnum
ALTER TYPE "EmailOutboxStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "actorEmail" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "ContactEnquiry" ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "BulkOrderLead" ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "netQuantity" TEXT,
ADD COLUMN     "hsnCode" TEXT;

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "recipientName" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "invoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "EmailOutbox" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiImageGenerationEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminUserId" TEXT,

    CONSTRAINT "AiImageGenerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiImageGenerationEvent_createdAt_idx" ON "AiImageGenerationEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AdminNotification_read_createdAt_idx" ON "AdminNotification"("read", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_razorpayOrderId_idx" ON "Order"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Order_razorpayPaymentId_idx" ON "Order"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");
