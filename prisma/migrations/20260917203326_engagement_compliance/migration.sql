-- engagement_compliance
--
-- Hand-written (not `prisma migrate dev`-generated) because two of the
-- changes need data-aware steps Prisma's own diff can't express safely:
--   1. NewsletterSubscriber.unsubscribeToken is NOT NULL + UNIQUE with a
--      Prisma-level (client-side) default, so it can't just be added as
--      NOT NULL against the 63 existing rows — they're backfilled with a
--      generated token in the same shape (`c` + 24 lowercase alphanumeric
--      chars) as Prisma's own cuid() default before the column is made
--      required.
--   2. JourneyEnrollment intentionally does NOT get a blanket
--      `UNIQUE (journeyId, email)` — see the comment on that model in
--      schema.prisma. Only a *partial* unique index (ACTIVE rows only) is
--      correct, and Prisma's schema DSL has no way to express a partial
--      index, so it's added here as raw SQL.

-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'SENDING';
ALTER TYPE "CampaignStatus" ADD VALUE 'FAILED';

-- AlterTable: NewsletterSubscriber
ALTER TABLE "NewsletterSubscriber"
  ALTER COLUMN "consentGiven" SET DEFAULT false,
  ADD COLUMN     "confirmedAt" TIMESTAMP(3),
  ADD COLUMN     "confirmToken" TEXT,
  ADD COLUMN     "unsubscribedAt" TIMESTAMP(3),
  ADD COLUMN     "unsubscribeToken" TEXT;

-- Backfill existing rows with a unique, cuid-shaped unsubscribe token
-- (Postgres has no cuid() function, so this approximates the same shape —
-- "c" + 24 lowercase alphanumeric chars — that isValidUnsubscribeToken()
-- and Prisma's own @default(cuid()) both expect). md5() of a random value
-- combined with the row's own id guarantees no collisions across rows.
UPDATE "NewsletterSubscriber"
SET "unsubscribeToken" = 'c' || substr(md5(random()::text || id || clock_timestamp()::text), 1, 24)
WHERE "unsubscribeToken" IS NULL;

ALTER TABLE "NewsletterSubscriber"
  ALTER COLUMN "unsubscribeToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_confirmToken_key" ON "NewsletterSubscriber"("confirmToken");
CREATE UNIQUE INDEX "NewsletterSubscriber_unsubscribeToken_key" ON "NewsletterSubscriber"("unsubscribeToken");

-- AlterTable: JourneyEnrollment
ALTER TABLE "JourneyEnrollment" ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JourneyEnrollment_journeyId_email_idx" ON "JourneyEnrollment"("journeyId", "email");

-- Partial unique index: at most one ACTIVE enrollment per (journeyId, email).
-- Deliberately NOT a plain UNIQUE(journeyId, email) constraint — triggers
-- like cart_abandoned/order_created/bulk_lead_created legitimately create a
-- new (COMPLETED/CANCELLED) enrollment each time they fire, so only
-- concurrently-ACTIVE duplicates should ever be blocked.
CREATE UNIQUE INDEX "JourneyEnrollment_journeyId_email_active_key"
  ON "JourneyEnrollment"("journeyId", "email")
  WHERE "status" = 'ACTIVE' AND "email" IS NOT NULL;

-- CreateTable: CampaignDelivery
CREATE TABLE "CampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" "TemplateChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDelivery_campaignId_recipient_channel_key" ON "CampaignDelivery"("campaignId", "recipient", "channel");
CREATE INDEX "CampaignDelivery_campaignId_idx" ON "CampaignDelivery"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: WhatsAppOptIn
CREATE TABLE "WhatsAppOptIn" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "optedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppOptIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppOptIn_phone_key" ON "WhatsAppOptIn"("phone");

-- CreateTable: CronRun
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronRun_job_runKey_key" ON "CronRun"("job", "runKey");
