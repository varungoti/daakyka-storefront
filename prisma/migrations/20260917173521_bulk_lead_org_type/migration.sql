-- AlterTable
ALTER TABLE "BulkOrderLead" ADD COLUMN     "categoryInterest" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "organizationType" TEXT;
