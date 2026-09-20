-- Partial unique index: a given email may have only one PENDING (not yet
-- notified) back-in-stock subscription per variant — de-dupes signups
-- without blocking the same email from subscribing again on a future
-- restock cycle once the prior subscription has been notified.
-- Case-insensitive on email (lower(email)) since the application layer
-- normalizes to lowercase before insert but this guards direct writes too.
-- Same "partial unique index via raw SQL, Prisma's schema DSL can't
-- express a WHERE clause on an index" precedent as JourneyEnrollment's own
-- ACTIVE-only partial unique index (see the engagement_compliance
-- migration and the doc comment on JourneyEnrollment in schema.prisma).
CREATE UNIQUE INDEX "BackInStockSubscription_variant_email_pending_key"
  ON "BackInStockSubscription" ("variantId", lower("email"))
  WHERE "notifiedAt" IS NULL;
