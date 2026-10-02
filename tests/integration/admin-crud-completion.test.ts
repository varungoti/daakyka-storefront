import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { processDueScheduledCampaigns } from "@/lib/engagement/campaign-dispatcher";
import { setIntegrationEnabled } from "@/lib/integrations/enabled";
import { withEnv } from "../helpers/env";
import {
  DELETE as deleteCampaignRoute,
  GET as getCampaignRoute,
  PATCH as patchCampaignRoute,
} from "@/app/api/admin/campaigns/[id]/route";

import {
  createTestimonial,
  deleteTestimonial,
  getTestimonialForAdmin,
  TestimonialNotFoundError,
  updateTestimonial,
} from "@/lib/testimonials";
import { GET as getTestimonials, POST as postTestimonial } from "@/app/api/admin/testimonials/route";
import {
  DELETE as deleteTestimonialRoute,
  GET as getTestimonial,
  PATCH as patchTestimonial,
} from "@/app/api/admin/testimonials/[id]/route";

import {
  createSegment,
  deleteSegment,
  getSegmentForAdmin,
  SegmentDeleteBlockedError,
  SegmentNotFoundError,
  SegmentSlugConflictError,
  updateSegment,
} from "@/lib/engagement/segments";
import { GET as getSegments, POST as postSegment } from "@/app/api/admin/segments/route";
import {
  DELETE as deleteSegmentRoute,
  GET as getSegment,
  PATCH as patchSegment,
} from "@/app/api/admin/segments/[id]/route";

import {
  createTemplate,
  deleteTemplate,
  getTemplateForAdmin,
  TemplateDeleteBlockedError,
  TemplateNotFoundError,
  updateTemplate,
} from "@/lib/engagement/templates";
import { GET as getTemplates, POST as postTemplate } from "@/app/api/admin/templates/route";
import {
  DELETE as deleteTemplateRoute,
  GET as getTemplate,
  PATCH as patchTemplate,
} from "@/app/api/admin/templates/[id]/route";
import { POST as sendTestTemplateRoute, resolveTestSendSource } from "@/app/api/admin/templates/[id]/send-test/route";

import { createOffer, deleteOffer, getOfferForAdmin, OfferNotFoundError, updateOffer } from "@/lib/offers";
import { GET as getOffers, POST as postOffer } from "@/app/api/admin/offers/route";
import { DELETE as deleteOfferRoute, GET as getOffer, PATCH as patchOffer } from "@/app/api/admin/offers/[id]/route";

import {
  createSeoRecord,
  deleteSeoRecord,
  getSeoRecordForAdmin,
  SeoPagePathConflictError,
  SeoPagePathNotWiredError,
  SeoPageRecordNotFoundError,
  updateSeoRecord,
} from "@/lib/seo/records";
import { GET as getSeoRecords, POST as postSeoRecord } from "@/app/api/admin/seo/route";
import {
  DELETE as deleteSeoRecordRoute,
  GET as getSeoRecord,
  PATCH as patchSeoRecord,
  PUT as putSeoRecord,
} from "@/app/api/admin/seo/[id]/route";

import { markAllNotificationsRead, markNotificationRead, NotificationNotFoundError } from "@/lib/notifications";
import { PATCH as patchNotification } from "@/app/api/admin/notifications/[id]/route";
import { POST as markAllReadRoute } from "@/app/api/admin/notifications/mark-all-read/route";

import {
  AccountLockedForPasswordChangeError,
  changeOwnPassword,
  CurrentPasswordIncorrectError,
  deleteUser,
  inviteUser,
  LastSuperAdminError,
  resetUserPassword,
  updateAdminUser,
  UserDeleteBlockedError,
  UserEmailConflictError,
  UserNotFoundError,
  UserSelfActionBlockedError,
  WeakPasswordError,
} from "@/lib/auth/user-admin";
import { JourneyNotFoundError, updateJourneyStatus } from "@/lib/engagement/journeys";
import { verifyPassword } from "@/lib/auth/password";
import { POST as postUser } from "@/app/api/admin/users/route";
import { DELETE as deleteUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/reset-password/route";
import { POST as postChangeOwnPassword } from "@/app/api/admin/account/password/route";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * Admin CRUD-completion phase: testimonials, segments, templates, offers,
 * SEO records, notifications, and users — closing the read-only/partial
 * admin screens flagged in the earlier audit.
 *
 * Same constraint as tests/integration/catalog-admin.test.ts: route
 * handlers can't be called with a real authenticated session outside an
 * actual Next.js request (requireAdminPermission's getSession() needs
 * next/headers' cookies()), so business rules are exercised directly
 * against the service-layer functions, and every route handler is
 * separately checked for a 401/403 rejection with no session. Every row
 * created here is cleaned up in `after()`.
 */

const idParams = Promise.resolve({ id: "any-id" });
const jsonRequest = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("testimonials admin CRUD", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) await db.testimonialRecord.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("full round trip: create -> read -> update -> delete", async () => {
    const testimonial = await createTestimonial(
      {
        quote: "Excellent quality scrubs and fast delivery every time.",
        name: `Test Reviewer ${randomUUID().slice(0, 8)}`,
        title: "Ward Nurse",
        rating: 5,
        avatar: "https://example.com/avatar.jpg",
        featured: false,
        active: true,
        sortOrder: 0,
      },
      adminId,
    );
    createdIds.push(testimonial.id);

    const fetched = await getTestimonialForAdmin(testimonial.id);
    assert.equal(fetched.id, testimonial.id);

    const updated = await updateTestimonial(testimonial.id, { featured: true, rating: 4 }, adminId);
    assert.equal(updated.featured, true);
    assert.equal(updated.rating, 4);

    await deleteTestimonial(testimonial.id, adminId);
    createdIds.splice(createdIds.indexOf(testimonial.id), 1);
    await assert.rejects(() => getTestimonialForAdmin(testimonial.id), TestimonialNotFoundError);
  });

  it("updateTestimonial/deleteTestimonial throw TestimonialNotFoundError for an unknown id", async () => {
    await assert.rejects(() => updateTestimonial("does-not-exist", { featured: true }, adminId), TestimonialNotFoundError);
    await assert.rejects(() => deleteTestimonial("does-not-exist", adminId), TestimonialNotFoundError);
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok([401, 403].includes((await getTestimonials()).status));
    assert.ok(
      [401, 403].includes(
        (await postTestimonial(jsonRequest("http://localhost/api/admin/testimonials", "POST", {}))).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await getTestimonial(jsonRequest("http://localhost/api/admin/testimonials/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchTestimonial(jsonRequest("http://localhost/api/admin/testimonials/any-id", "PATCH", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteTestimonialRoute(jsonRequest("http://localhost/api/admin/testimonials/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
  });
});

describe("segments admin CRUD", () => {
  let adminId: string;
  const createdIds: string[] = [];
  const createdCampaignIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdCampaignIds.length) await db.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } }).catch(() => {});
    if (createdIds.length) await db.customerSegment.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("full round trip: create -> read -> update -> delete", async () => {
    const unique = randomUUID().slice(0, 8);
    const segment = await createSegment(
      { name: `Test Segment ${unique}`, slug: `test-segment-${unique}`, criteria: { source: "newsletter" } },
      adminId,
    );
    createdIds.push(segment.id);

    const fetched = await getSegmentForAdmin(segment.id);
    assert.deepEqual(JSON.parse(fetched.criteria), { source: "newsletter" });

    const updated = await updateSegment(segment.id, { description: "Updated desc", criteria: { consent: true } }, adminId);
    assert.equal(updated.description, "Updated desc");
    assert.deepEqual(JSON.parse(updated.criteria), { consent: true });

    await deleteSegment(segment.id, adminId);
    createdIds.splice(createdIds.indexOf(segment.id), 1);
    await assert.rejects(() => getSegmentForAdmin(segment.id), SegmentNotFoundError);
  });

  it("audit rows record the segment's name on create and what changed on edit (F-288)", async () => {
    const unique = randomUUID().slice(0, 8);
    const segment = await createSegment({ name: `Audit Segment ${unique}`, slug: `audit-segment-${unique}`, criteria: { source: "footer" } }, adminId);
    createdIds.push(segment.id);
    await updateSegment(segment.id, { description: "now described", criteria: { source: "checkout" } }, adminId);

    const rows = await db.auditLog.findMany({ where: { entity: "customer_segment", entityId: segment.id }, orderBy: { createdAt: "asc" } });
    const [created, updated] = rows.map(
      (row) => JSON.parse(row.metadata ?? "{}") as { name?: string; slug?: string; changes?: Record<string, unknown>; criteriaChanged?: boolean },
    );
    assert.equal(created.slug, `audit-segment-${unique}`);
    assert.deepEqual(updated.changes, { description: { from: null, to: "now described" } });
    assert.equal(updated.criteriaChanged, true);
  });

  it("createSegment rejects a slug already used by another segment", async () => {
    const unique = randomUUID().slice(0, 8);
    const first = await createSegment({ name: `Dup ${unique}`, slug: `dup-segment-${unique}` }, adminId);
    createdIds.push(first.id);

    await assert.rejects(
      () => createSegment({ name: "Different Name", slug: `dup-segment-${unique}` }, adminId),
      SegmentSlugConflictError,
    );
  });

  it("deleteSegment is blocked while an active campaign references it", async () => {
    const unique = randomUUID().slice(0, 8);
    const segment = await createSegment({ name: `Referenced ${unique}`, slug: `referenced-${unique}` }, adminId);
    createdIds.push(segment.id);

    const campaign = await db.campaign.create({
      data: { name: `Campaign ${unique}`, channel: "EMAIL", status: "DRAFT", segmentId: segment.id },
    });
    createdCampaignIds.push(campaign.id);

    const error = await deleteSegment(segment.id, adminId).catch((e) => e);
    assert.ok(error instanceof SegmentDeleteBlockedError);

    // A SENT/CANCELLED campaign no longer blocks the delete.
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "SENT" } });
    await deleteSegment(segment.id, adminId);
    createdIds.splice(createdIds.indexOf(segment.id), 1);
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok([401, 403].includes((await getSegments()).status));
    assert.ok(
      [401, 403].includes(
        (await postSegment(jsonRequest("http://localhost/api/admin/segments", "POST", {}))).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await getSegment(jsonRequest("http://localhost/api/admin/segments/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchSegment(jsonRequest("http://localhost/api/admin/segments/any-id", "PATCH", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteSegmentRoute(jsonRequest("http://localhost/api/admin/segments/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
  });
});

describe("templates admin CRUD", () => {
  let adminId: string;
  const createdIds: string[] = [];
  const createdCampaignIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdCampaignIds.length) await db.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } }).catch(() => {});
    if (createdIds.length) await db.messageTemplate.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("audit rows record what a template edit changed, flagging the body without copying it (F-288)", async () => {
    const template = await createTemplate(
      { name: `Audit Template ${randomUUID().slice(0, 8)}`, channel: "EMAIL", body: "original body text" },
      adminId,
    );
    createdIds.push(template.id);
    await updateTemplate(template.id, { subject: "A new subject", body: "rewritten secret-marker body" }, adminId);

    const rows = await db.auditLog.findMany({ where: { entity: "message_template", entityId: template.id }, orderBy: { createdAt: "asc" } });
    const [created, updated] = rows.map(
      (row) => JSON.parse(row.metadata ?? "{}") as { channel?: string; changes?: Record<string, unknown>; bodyChanged?: boolean },
    );
    assert.equal(created.channel, "EMAIL");
    assert.deepEqual(updated.changes, { subject: { from: null, to: "A new subject" } });
    assert.equal(updated.bodyChanged, true);
    assert.ok(!(rows[1].metadata ?? "").includes("secret-marker"));
  });

  it("full round trip: create -> read -> update -> delete", async () => {
    const template = await createTemplate(
      { name: `Test Template ${randomUUID().slice(0, 8)}`, channel: "EMAIL", body: "Hi {{first_name}}, welcome!" },
      adminId,
    );
    createdIds.push(template.id);

    const fetched = await getTemplateForAdmin(template.id);
    assert.equal(fetched.body, "Hi {{first_name}}, welcome!");

    const updated = await updateTemplate(template.id, { subject: "Welcome!" }, adminId);
    assert.equal(updated.subject, "Welcome!");

    await deleteTemplate(template.id, adminId);
    createdIds.splice(createdIds.indexOf(template.id), 1);
    await assert.rejects(() => getTemplateForAdmin(template.id), TemplateNotFoundError);
  });

  it("deleteTemplate is blocked while an in-flight (APPROVED/SCHEDULED/SENDING) campaign references it", async () => {
    const unique = randomUUID().slice(0, 8);
    const template = await createTemplate({ name: `Referenced ${unique}`, channel: "EMAIL", body: "Body content here" }, adminId);
    createdIds.push(template.id);

    const campaign = await db.campaign.create({
      data: { name: `Campaign ${unique}`, channel: "EMAIL", status: "SCHEDULED", templateId: template.id },
    });
    createdCampaignIds.push(campaign.id);

    await assert.rejects(() => deleteTemplate(template.id, adminId), TemplateDeleteBlockedError);

    await db.campaign.delete({ where: { id: campaign.id } });
    createdCampaignIds.splice(createdCampaignIds.indexOf(campaign.id), 1);
    await deleteTemplate(template.id, adminId);
    createdIds.splice(createdIds.indexOf(template.id), 1);
  });

  // F-217: a SENT/DRAFT/PENDING_APPROVAL/CANCELLED/FAILED campaign is not
  // "in flight" — it no longer blocks deleting the template. This is what
  // makes the seeded "Welcome Email" template (referenced by the seeded
  // PENDING_APPROVAL "Welcome Series — Week 1" campaign) deletable, instead
  // of permanently stuck the way any prior reference used to block it.
  // Campaign.templateId is onDelete: SetNull, so the reference is nulled,
  // not left dangling.
  it("deleteTemplate is NOT blocked by a SENT campaign, and nulls that campaign's templateId", async () => {
    const unique = randomUUID().slice(0, 8);
    const template = await createTemplate({ name: `Historical ${unique}`, channel: "EMAIL", body: "Body content here" }, adminId);
    createdIds.push(template.id);

    const campaign = await db.campaign.create({
      data: { name: `Sent Campaign ${unique}`, channel: "EMAIL", status: "SENT", templateId: template.id },
    });
    createdCampaignIds.push(campaign.id);

    await deleteTemplate(template.id, adminId);
    createdIds.splice(createdIds.indexOf(template.id), 1);

    const refetched = await db.campaign.findUnique({ where: { id: campaign.id } });
    assert.equal(refetched?.templateId, null);
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok([401, 403].includes((await getTemplates()).status));
    assert.ok(
      [401, 403].includes(
        (await postTemplate(jsonRequest("http://localhost/api/admin/templates", "POST", {}))).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await getTemplate(jsonRequest("http://localhost/api/admin/templates/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchTemplate(jsonRequest("http://localhost/api/admin/templates/any-id", "PATCH", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteTemplateRoute(jsonRequest("http://localhost/api/admin/templates/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await sendTestTemplateRoute(jsonRequest("http://localhost/api/admin/templates/any-id/send-test", "POST"), { params: idParams })).status,
      ),
    );
  });

  // F-217: "Send test" used to always render the saved row, so testing an
  // unsaved edit silently sent the old copy — resolveTestSendSource is the
  // route's precedence rule (posted override beats the saved template),
  // tested directly since requireAdminPermission needs a real session the
  // route itself can't be driven through here (see this file's header
  // comment).
  it("resolveTestSendSource prefers the posted (possibly unsaved) subject/body over the saved template", () => {
    const saved = { name: "Welcome Email", subject: "Saved subject", body: "Saved body" };

    assert.deepEqual(resolveTestSendSource(saved, {}), { subject: "Saved subject", body: "Saved body" });
    assert.deepEqual(resolveTestSendSource(saved, { body: "Unsaved draft body" }), {
      subject: "Saved subject",
      body: "Unsaved draft body",
    });
    assert.deepEqual(resolveTestSendSource(saved, { subject: "Unsaved draft subject", body: "Unsaved draft body" }), {
      subject: "Unsaved draft subject",
      body: "Unsaved draft body",
    });
    // No saved subject (e.g. a WHATSAPP template) and no override falls
    // back to a generic "[Test] <name>" subject, same as before this fix.
    assert.deepEqual(resolveTestSendSource({ ...saved, subject: null }, {}), {
      subject: "[Test] Welcome Email",
      body: "Saved body",
    });
  });
});

describe("offers admin CRUD", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) await db.offerRecommendation.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("full round trip: create -> read -> update (toggle active) -> delete", async () => {
    const offer = await createOffer(
      { name: `Test Offer ${randomUUID().slice(0, 8)}`, type: "bundle", description: "Save on a top+bottom set.", active: true },
      adminId,
    );
    createdIds.push(offer.id);

    const fetched = await getOfferForAdmin(offer.id);
    assert.equal(fetched.active, true);

    const updated = await updateOffer(offer.id, { active: false, config: { discount: "15%" } }, adminId);
    assert.equal(updated.active, false);
    assert.deepEqual(JSON.parse(updated.config), { discount: "15%" });

    await deleteOffer(offer.id, adminId);
    createdIds.splice(createdIds.indexOf(offer.id), 1);
    await assert.rejects(() => getOfferForAdmin(offer.id), OfferNotFoundError);
  });

  // F-288: offers (and segments / templates below) wrote create rows with no
  // metadata at all and update rows with only the new name.
  it("audit rows record what was created and what an edit changed (F-288)", async () => {
    const offer = await createOffer(
      { name: `Audit Offer ${randomUUID().slice(0, 8)}`, type: "bundle", description: "d", active: true },
      adminId,
    );
    createdIds.push(offer.id);
    await updateOffer(offer.id, { active: false, config: { discount: "15%" } }, adminId);

    const rows = await db.auditLog.findMany({
      where: { entity: "offer_recommendation", entityId: offer.id },
      orderBy: { createdAt: "asc" },
    });
    const [created, updated] = rows.map(
      (row) => JSON.parse(row.metadata ?? "{}") as { name?: string; active?: boolean; changes?: Record<string, unknown>; configChanged?: boolean },
    );
    assert.equal(created.name, offer.name);
    assert.equal(created.active, true);
    assert.deepEqual(updated.changes, { active: { from: true, to: false } });
    assert.equal(updated.configChanged, true);
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok([401, 403].includes((await getOffers()).status));
    assert.ok(
      [401, 403].includes((await postOffer(jsonRequest("http://localhost/api/admin/offers", "POST", {}))).status),
    );
    assert.ok(
      [401, 403].includes(
        (await getOffer(jsonRequest("http://localhost/api/admin/offers/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchOffer(jsonRequest("http://localhost/api/admin/offers/any-id", "PATCH", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteOfferRoute(jsonRequest("http://localhost/api/admin/offers/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
  });
});

describe("SEO records admin CRUD", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) await db.seoPageRecord.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  // F-052 fix: createSeoRecord now rejects a *new* record for a path the
  // storefront doesn't actually read overrides from (src/lib/seo/
  // wired-paths.ts) — see the two rejection tests below. This round trip
  // instead inserts the row directly, the same way an existing off-wired
  // record (e.g. prisma/seed.ts's "/bulk-orders" row, or one created before
  // this fix) would already be sitting in the table, to prove read/update/
  // delete are untouched by the new restriction — it only applies to create.
  it("full round trip: read -> update -> delete (an existing off-wired record)", async () => {
    const unique = randomUUID().slice(0, 8);
    const record = await db.seoPageRecord.create({
      data: {
        path: `/test-seo-${unique}`,
        title: "Test Page",
        metaDescription: "A test meta description.",
        status: "ok",
        issues: "[]",
      },
    });
    createdIds.push(record.id);

    const fetched = await getSeoRecordForAdmin(record.id);
    assert.equal(fetched.status, "ok");

    const updated = await updateSeoRecord(record.id, { title: "Updated Title", status: "needs_meta" }, adminId);
    assert.equal(updated.title, "Updated Title");
    assert.equal(updated.status, "needs_meta");

    await deleteSeoRecord(record.id, adminId);
    createdIds.splice(createdIds.indexOf(record.id), 1);
    await assert.rejects(() => getSeoRecordForAdmin(record.id), SeoPageRecordNotFoundError);
  });

  it("createSeoRecord rejects a new path that isn't read live by the storefront", async () => {
    const unique = randomUUID().slice(0, 8);
    await assert.rejects(
      () =>
        createSeoRecord(
          { path: `/test-seo-not-wired-${unique}`, title: "Test", metaDescription: "A test meta description." },
          adminId,
        ),
      SeoPagePathNotWiredError,
    );
  });

  it("updateSeoRecord rejects repointing a record onto a path the storefront never reads", async () => {
    // F-052: the create guard alone left a side door, since an API caller
    // could create a wired record and then PATCH its path to anything. A
    // legacy off-wired row keeps its other fields editable (round trip
    // above) but cannot be moved onto another unwired path.
    const unique = randomUUID().slice(0, 8);
    const record = await db.seoPageRecord.create({
      data: {
        path: `/test-seo-repoint-${unique}`,
        title: "Repoint Test",
        metaDescription: "A test meta description.",
        status: "ok",
        issues: "[]",
      },
    });
    createdIds.push(record.id);

    await assert.rejects(
      () => updateSeoRecord(record.id, { path: `/test-seo-still-not-wired-${unique}` }, adminId),
      SeoPagePathNotWiredError,
    );
    const unchanged = await getSeoRecordForAdmin(record.id);
    assert.equal(unchanged.path, `/test-seo-repoint-${unique}`);

    // Passing the same path back is not a move, so it is still accepted.
    const same = await updateSeoRecord(record.id, { path: record.path, title: "Repoint Test 2" }, adminId);
    assert.equal(same.title, "Repoint Test 2");
  });

  it("createSeoRecord rejects a wired path already in use", async () => {
    // prisma/seed.ts always seeds a "/" row, so this needs no setup of its
    // own — proves the not-wired check (above) doesn't shadow the
    // pre-existing path-conflict check for a path that *is* wired.
    await assert.rejects(
      () => createSeoRecord({ path: "/", title: "Duplicate", metaDescription: "Duplicate description." }, adminId),
      SeoPagePathConflictError,
    );
  });

  it("routes reject with 401/403 without a session (including PUT alias)", async () => {
    assert.ok([401, 403].includes((await getSeoRecords()).status));
    assert.ok(
      [401, 403].includes((await postSeoRecord(jsonRequest("http://localhost/api/admin/seo", "POST", {}))).status),
    );
    assert.ok(
      [401, 403].includes(
        (await getSeoRecord(jsonRequest("http://localhost/api/admin/seo/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchSeoRecord(jsonRequest("http://localhost/api/admin/seo/any-id", "PATCH", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await putSeoRecord(jsonRequest("http://localhost/api/admin/seo/any-id", "PUT", {}), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteSeoRecordRoute(jsonRequest("http://localhost/api/admin/seo/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
  });
});

describe("notifications mark-read admin", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) await db.adminNotification.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("markNotificationRead flips the read flag and is reversible", async () => {
    const notification = await db.adminNotification.create({
      data: { title: "Test", body: "Test notification body", type: "test" },
    });
    createdIds.push(notification.id);

    const marked = await markNotificationRead(notification.id, true, adminId);
    assert.equal(marked.read, true);

    const unmarked = await markNotificationRead(notification.id, false, adminId);
    assert.equal(unmarked.read, false);
  });

  it("markNotificationRead throws NotificationNotFoundError for an unknown id", async () => {
    await assert.rejects(() => markNotificationRead("does-not-exist", true, adminId), NotificationNotFoundError);
  });

  it("markAllNotificationsRead marks every unread notification read", async () => {
    const a = await db.adminNotification.create({ data: { title: "A", body: "A body", type: "test" } });
    const b = await db.adminNotification.create({ data: { title: "B", body: "B body", type: "test" } });
    createdIds.push(a.id, b.id);

    const count = await markAllNotificationsRead(adminId);
    assert.ok(count >= 2);

    const refetched = await db.adminNotification.findMany({ where: { id: { in: [a.id, b.id] } } });
    assert.ok(refetched.every((n) => n.read === true));
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok(
      [401, 403].includes(
        (await patchNotification(jsonRequest("http://localhost/api/admin/notifications/any-id", "PATCH", { read: true }), { params: idParams })).status,
      ),
    );
    assert.ok([401, 403].includes((await markAllReadRoute()).status));
  });
});

describe("users admin CRUD (invite, reset-password, delete)", () => {
  let adminId: string;
  const createdUserIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdUserIds.length) await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  });

  it("inviteUser creates a login-capable user and returns a one-time temp password", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `invited-${unique}@example.com`;
    const result = await inviteUser({ name: "Invited Admin", email, role: "VIEWER" }, adminId);
    createdUserIds.push(result.user.id);

    assert.equal(result.user.email, email.toLowerCase());
    assert.ok(result.tempPassword.length >= 8);

    const row = await db.user.findUnique({ where: { id: result.user.id } });
    assert.ok(row);
    assert.notEqual(row!.passwordHash, result.tempPassword, "only the hash should be stored");
    // F-057: a fresh invite's temp password must be flagged for a
    // mandatory change at next login, not silently usable forever.
    assert.equal(row!.mustChangePassword, true);

    const { verifyPassword } = await import("@/lib/auth/password");
    assert.equal(await verifyPassword(result.tempPassword, row!.passwordHash), true);
  });

  it("inviteUser rejects a duplicate email", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `invited-dup-${unique}@example.com`;
    const first = await inviteUser({ name: "First", email, role: "VIEWER" }, adminId);
    createdUserIds.push(first.user.id);

    await assert.rejects(() => inviteUser({ name: "Second", email, role: "VIEWER" }, adminId), UserEmailConflictError);
  });

  it("resetUserPassword issues a new working temp password and revokes old sessions", async () => {
    const unique = randomUUID().slice(0, 8);
    const invited = await inviteUser({ name: "Reset Me", email: `reset-${unique}@example.com`, role: "VIEWER" }, adminId);
    createdUserIds.push(invited.user.id);

    const before = await db.user.findUnique({ where: { id: invited.user.id }, select: { sessionVersion: true } });
    const result = await resetUserPassword(invited.user.id, adminId);
    const after = await db.user.findUnique({ where: { id: invited.user.id }, select: { sessionVersion: true, passwordHash: true } });

    assert.equal(after!.sessionVersion, before!.sessionVersion + 1);
    const { verifyPassword } = await import("@/lib/auth/password");
    assert.equal(await verifyPassword(result.tempPassword, after!.passwordHash), true);

    // F-057: an admin-triggered reset must also require a change at next
    // login — otherwise the new temp password can just as easily become
    // permanent as the original one.
    const afterFull = await db.user.findUnique({ where: { id: invited.user.id }, select: { mustChangePassword: true } });
    assert.equal(afterFull!.mustChangePassword, true);
  });

  it("resetUserPassword throws UserNotFoundError for an unknown id", async () => {
    await assert.rejects(() => resetUserPassword("does-not-exist", adminId), UserNotFoundError);
  });

  it("resetUserPassword clears an existing lockout on the target user (F-164)", async () => {
    const unique = randomUUID().slice(0, 8);
    const invited = await inviteUser({ name: "Locked Out", email: `locked-${unique}@example.com`, role: "VIEWER" }, adminId);
    createdUserIds.push(invited.user.id);

    // Simulate the account having tripped the lockout (src/lib/auth/lockout.ts)
    // before an admin steps in to reset the password.
    await db.user.update({
      where: { id: invited.user.id },
      data: { failedLoginCount: 10, lastFailedLoginAt: new Date(), lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });

    await resetUserPassword(invited.user.id, adminId);

    const after = await db.user.findUnique({
      where: { id: invited.user.id },
      select: { failedLoginCount: true, lastFailedLoginAt: true, lockedUntil: true },
    });
    assert.equal(after!.failedLoginCount, 0);
    assert.equal(after!.lastFailedLoginAt, null);
    assert.equal(after!.lockedUntil, null);

    const { isLocked } = await import("@/lib/auth/lockout");
    assert.equal(isLocked(after!), false);
  });

  it("resetUserPassword returns the role and bumped sessionVersion needed to reissue a session, so a self-reset can keep the caller signed in (F-159)", async () => {
    const unique = randomUUID().slice(0, 8);
    const invited = await inviteUser(
      { name: "Self Reset", email: `selfreset-${unique}@example.com`, role: "VIEWER" },
      adminId,
    );
    createdUserIds.push(invited.user.id);

    // The reset-password route (src/app/api/admin/users/[id]/reset-password/route.ts)
    // reissues the caller's session cookie with exactly this role/sessionVersion
    // when id === session.id, instead of leaving the just-bumped sessionVersion
    // to reject the caller's existing cookie on the very next request. Exercise
    // that same signSessionToken/verifySessionToken round trip directly, since
    // the route itself can't be driven through cookies() outside a real request
    // (see the harness note atop tests/integration/admin-auth.test.ts).
    const result = await resetUserPassword(invited.user.id, invited.user.id);
    assert.equal(result.role, "VIEWER");

    const { signSessionToken, verifySessionToken } = await import("@/lib/auth/session");
    const reissuedToken = await signSessionToken(
      { id: result.user.id, email: result.user.email, name: result.user.name, role: result.role },
      result.sessionVersion,
    );
    const verified = await verifySessionToken(reissuedToken);
    assert.ok(verified, "a token minted with the post-reset sessionVersion must verify, not log the caller out");
    assert.equal(verified!.id, result.user.id);

    // A token still carrying the pre-reset sessionVersion (what the caller's
    // browser cookie holds until it's reissued) must be rejected — the fix
    // must not weaken revocation for everyone else.
    const staleToken = await signSessionToken(
      { id: result.user.id, email: result.user.email, name: result.user.name, role: result.role },
      result.sessionVersion - 1,
    );
    assert.equal(await verifySessionToken(staleToken), null);
  });

  // F-057: self-service password change — admins previously had no way to
  // rotate their own password at all (only a SUPER_ADMIN-triggered reset
  // to another random temp password). See src/lib/auth/user-admin.ts's
  // changeOwnPassword doc comment.
  describe("changeOwnPassword (F-057)", () => {
    it("changes the password, bumps sessionVersion, and clears mustChangePassword", async () => {
      const unique = randomUUID().slice(0, 8);
      const invited = await inviteUser({ name: "Change PW", email: `changepw-${unique}@example.com`, role: "VIEWER" }, adminId);
      createdUserIds.push(invited.user.id);

      const before = await db.user.findUnique({ where: { id: invited.user.id }, select: { sessionVersion: true } });
      const result = await changeOwnPassword(invited.user.id, invited.tempPassword, "a-brand-new-password-123");
      assert.equal(result.sessionVersion, before!.sessionVersion + 1);

      const after = await db.user.findUnique({ where: { id: invited.user.id } });
      assert.equal(after!.mustChangePassword, false, "a self-chosen password clears the forced-change flag");
      assert.equal(await verifyPassword("a-brand-new-password-123", after!.passwordHash), true);
      assert.equal(await verifyPassword(invited.tempPassword, after!.passwordHash), false, "the old temp password must stop working");
    });

    it("rejects the wrong current password and counts it toward the same lockout login uses", async () => {
      const unique = randomUUID().slice(0, 8);
      const invited = await inviteUser({ name: "Wrong PW", email: `wrongpw-${unique}@example.com`, role: "VIEWER" }, adminId);
      createdUserIds.push(invited.user.id);

      await assert.rejects(
        () => changeOwnPassword(invited.user.id, "not-the-real-temp-password", "a-brand-new-password-123"),
        CurrentPasswordIncorrectError,
      );

      const after = await db.user.findUnique({ where: { id: invited.user.id }, select: { failedLoginCount: true } });
      assert.equal(after!.failedLoginCount, 1, "a mismatch must feed the same lockout counter a failed login does");
    });

    it("locks the account after enough wrong guesses, and then rejects even the correct password", async () => {
      const unique = randomUUID().slice(0, 8);
      const invited = await inviteUser({ name: "Lock PW", email: `lockpw-${unique}@example.com`, role: "VIEWER" }, adminId);
      createdUserIds.push(invited.user.id);

      for (let attempt = 1; attempt <= 9; attempt++) {
        await assert.rejects(
          () => changeOwnPassword(invited.user.id, "wrong-guess", "a-brand-new-password-123"),
          CurrentPasswordIncorrectError,
          `attempt ${attempt} should still be a plain mismatch, not yet locked`,
        );
      }

      await assert.rejects(
        () => changeOwnPassword(invited.user.id, "wrong-guess", "a-brand-new-password-123"),
        AccountLockedForPasswordChangeError,
        "the 10th wrong guess should lock the account, mirroring login's own threshold",
      );

      await assert.rejects(
        () => changeOwnPassword(invited.user.id, invited.tempPassword, "a-brand-new-password-123"),
        AccountLockedForPasswordChangeError,
        "even the correct temp password must be refused while locked",
      );
    });

    it("rejects a new password shorter than 12 characters and one identical to the current password", async () => {
      const unique = randomUUID().slice(0, 8);
      const invited = await inviteUser({ name: "Weak PW", email: `weakpw-${unique}@example.com`, role: "VIEWER" }, adminId);
      createdUserIds.push(invited.user.id);

      await assert.rejects(
        () => changeOwnPassword(invited.user.id, invited.tempPassword, invited.tempPassword),
        WeakPasswordError,
        "reusing the current password must be rejected",
      );
    });

    it("throws UserNotFoundError for an unknown id", async () => {
      await assert.rejects(() => changeOwnPassword("does-not-exist", "whatever", "a-brand-new-password-123"), UserNotFoundError);
    });
  });

  it("deleteUser removes a fresh user with no activity history", async () => {
    const unique = randomUUID().slice(0, 8);
    const invited = await inviteUser({ name: "Delete Me", email: `delete-${unique}@example.com`, role: "VIEWER" }, adminId);
    createdUserIds.push(invited.user.id);

    await deleteUser(invited.user.id, adminId);
    createdUserIds.splice(createdUserIds.indexOf(invited.user.id), 1);

    assert.equal(await db.user.findUnique({ where: { id: invited.user.id } }), null);
  });

  it("deleteUser blocks deleting yourself", async () => {
    await assert.rejects(() => deleteUser(adminId, adminId), UserSelfActionBlockedError);
  });

  it("deleteUser blocks a user with activity history (audit log)", async () => {
    const unique = randomUUID().slice(0, 8);
    const invited = await inviteUser({ name: "Has History", email: `history-${unique}@example.com`, role: "VIEWER" }, adminId);
    createdUserIds.push(invited.user.id);

    await db.auditLog.create({
      data: { userId: invited.user.id, action: "test", entity: "test", entityId: "x" },
    });

    await assert.rejects(() => deleteUser(invited.user.id, adminId), UserDeleteBlockedError);

    // Deactivation remains solid even though hard delete is blocked.
    const deactivated = await db.user.update({ where: { id: invited.user.id }, data: { active: false } });
    assert.equal(deactivated.active, false);
  });

  it("deleteUser blocks removing the last active SUPER_ADMIN", async () => {
    const otherSuperAdmins = await db.user.count({ where: { role: "SUPER_ADMIN", active: true } });
    if (otherSuperAdmins !== 1) return; // Only meaningful with exactly one SUPER_ADMIN in this DB.

    const theOnlySuperAdmin = await db.user.findFirst({ where: { role: "SUPER_ADMIN", active: true } });
    assert.ok(theOnlySuperAdmin);
    await assert.rejects(() => deleteUser(theOnlySuperAdmin!.id, "some-other-acting-id"), LastSuperAdminError);
  });

  it("routes reject with 401/403 without a session", async () => {
    assert.ok(
      [401, 403].includes(
        (await postUser(jsonRequest("http://localhost/api/admin/users", "POST", {}))).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteUserRoute(jsonRequest("http://localhost/api/admin/users/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await resetPasswordRoute(jsonRequest("http://localhost/api/admin/users/any-id/reset-password", "POST"), { params: idParams })).status,
      ),
    );
    // F-057
    assert.ok(
      [401, 403].includes(
        (
          await postChangeOwnPassword(
            jsonRequest("http://localhost/api/admin/account/password", "POST", {
              currentPassword: "whatever",
              newPassword: "a-brand-new-password-123",
            }),
          )
        ).status,
      ),
    );
  });
});

describe("campaigns admin routes (F-217)", () => {
  it("GET/PATCH/DELETE reject with 401/403 without a session", async () => {
    assert.ok(
      [401, 403].includes(
        (await getCampaignRoute(jsonRequest("http://localhost/api/admin/campaigns/any-id", "GET"), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await patchCampaignRoute(jsonRequest("http://localhost/api/admin/campaigns/any-id", "PATCH", { name: "x" }), { params: idParams })).status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        (await deleteCampaignRoute(jsonRequest("http://localhost/api/admin/campaigns/any-id", "DELETE"), { params: idParams })).status,
      ),
    );
  });
});

// F-217: processDueScheduledCampaigns (src/lib/engagement/campaign-
// dispatcher.ts) already correctly filters on `scheduledAt <= now` — the
// actual bug was that nothing in the admin UI/API ever set a real
// scheduledAt when a campaign moved to SCHEDULED (it saved NULL, which
// this filter never matches), so a "scheduled" campaign silently never
// sent. campaigns/[id]/route.ts's PATCH handler now requires a real,
// future scheduledAt before it accepts a SCHEDULED transition at all —
// this proves the other half: once a campaign genuinely has a past-due
// scheduledAt, the existing dispatcher does pick it up and process it, so
// fixing the write path is sufficient and this exact dispatcher behavior
// doesn't also need to change. BREVO is enabled for this test only (with
// zero recipients, so nothing is actually sent) because dispatchCampaign
// now preflights the provider and leaves an unconfigured-provider campaign
// untouched on purpose (see ProviderNotConfiguredError) — that's a
// deliberate, separate concern from whether a past-due campaign is picked
// up at all, which is what this test is asserting. Both the enabled flag
// (setIntegrationEnabled) AND a configured key (isProviderConfigured, via
// BREVO_API_KEY + BREVO_FROM_EMAIL here rather than the encrypted DB
// credential store, which needs CREDENTIAL_ENCRYPTION_KEY — F-267: Brevo
// isn't "configured" without a From Email) are required for isIntegrationEnabled
// to report true — see src/lib/integrations/enabled.ts.
describe("processDueScheduledCampaigns picks up a past-due SCHEDULED campaign (F-217)", () => {
  const createdSegmentIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdCampaignIds: string[] = [];

  before(async () => {
    await setIntegrationEnabled("BREVO", true);
  });

  after(async () => {
    await setIntegrationEnabled("BREVO", false);
    if (createdCampaignIds.length) {
      await db.campaignDelivery.deleteMany({ where: { campaignId: { in: createdCampaignIds } } }).catch(() => {});
      await db.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } }).catch(() => {});
    }
    if (createdTemplateIds.length) {
      await db.messageTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } }).catch(() => {});
    }
    if (createdSegmentIds.length) {
      await db.customerSegment.deleteMany({ where: { id: { in: createdSegmentIds } } }).catch(() => {});
    }
  });

  it("dispatches (and moves off SCHEDULED) a campaign whose scheduledAt has already passed", async () => {
    const unique = randomUUID().slice(0, 8);

    const segment = await db.customerSegment.create({
      data: { name: `Sched Test ${unique}`, slug: `sched-test-${unique}`, criteria: JSON.stringify({}) },
    });
    createdSegmentIds.push(segment.id);

    const template = await db.messageTemplate.create({
      data: { name: `Sched Template ${unique}`, channel: "EMAIL", body: "Hi, this is a scheduled test." },
    });
    createdTemplateIds.push(template.id);

    const campaign = await db.campaign.create({
      data: {
        name: `Scheduled Past-Due ${unique}`,
        channel: "EMAIL",
        status: "SCHEDULED",
        segmentId: segment.id,
        templateId: template.id,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });
    createdCampaignIds.push(campaign.id);

    const { processed, results } = await withEnv({ BREVO_API_KEY: "test-key", BREVO_FROM_EMAIL: "orders@example.com" }, () =>
      processDueScheduledCampaigns(),
    );
    assert.ok(processed >= 1, "expected at least the seeded past-due campaign to be processed");
    assert.ok(
      results.some((r) => r.campaignId === campaign.id),
      "the past-due SCHEDULED campaign must be picked up by the dispatcher",
    );

    const refetched = await db.campaign.findUnique({ where: { id: campaign.id } });
    // The segment has zero recipients, so campaign-dispatcher.ts's own
    // "delivered to nobody" rule marks this FAILED rather than SENT —
    // either way, it must have moved off SCHEDULED, proving it was
    // actually picked up and processed instead of sitting forever the way
    // a scheduledAt=NULL row used to.
    assert.notEqual(refetched?.status, "SCHEDULED");
  });
});

// F-172: PATCH /api/admin/users/[id]'s rules now live in updateAdminUser
// (callable without a request scope). Its last-SUPER_ADMIN check used to be
// count-then-update outside a transaction, so two Super Admins demoting each
// other at once could leave none.
describe("updateAdminUser (F-172)", () => {
  let adminId: string;
  const createdUserIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdUserIds.length) await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  });

  async function inviteTestUser(role: "VIEWER" | "SUPER_ADMIN", label: string) {
    const unique = randomUUID().slice(0, 8);
    const slug = label.toLowerCase().replace(/\W+/g, "-");
    const invited = await inviteUser({ name: label, email: `${slug}-${unique}@example.com`, role }, adminId);
    createdUserIds.push(invited.user.id);
    return invited.user;
  }

  /** Holds a row lock on every active SUPER_ADMIN, exactly as an in-flight
   * updateAdminUser call does, until `release()` is called. */
  async function holdSuperAdminLock() {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lockAcquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "role" = 'SUPER_ADMIN' AND "active" = true FOR NO KEY UPDATE`;
      lockAcquired();
      await hold;
    });
    await locked;
    return {
      async release() {
        release();
        await holder;
      },
    };
  }

  it("renames a user without revoking their sessions", async () => {
    const user = await inviteTestUser("VIEWER", "Rename Me");
    const before = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });

    const updated = await updateAdminUser(user.id, { name: "Renamed Person", role: "VIEWER", active: true }, adminId);

    assert.equal(updated.name, "Renamed Person");
    const after = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true, name: true } });
    assert.equal(after!.name, "Renamed Person");
    assert.equal(after!.sessionVersion, before!.sessionVersion, "a plain name change must not log the admin out");
  });

  it("a role change or deactivation revokes the target's sessions", async () => {
    const user = await inviteTestUser("VIEWER", "Demote Me");
    const before = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });

    await updateAdminUser(user.id, { name: user.name, role: "CONTENT_EDITOR", active: true }, adminId);
    const afterRole = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true, role: true } });
    assert.equal(afterRole!.role, "CONTENT_EDITOR");
    assert.equal(afterRole!.sessionVersion, before!.sessionVersion + 1);

    await updateAdminUser(user.id, { name: user.name, role: "CONTENT_EDITOR", active: false }, adminId);
    const afterDeactivate = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true, active: true } });
    assert.equal(afterDeactivate!.active, false);
    assert.equal(afterDeactivate!.sessionVersion, before!.sessionVersion + 2);
  });

  // F-288: the audit row held only the NEW role, so a promotion to
  // SUPER_ADMIN never said what it replaced.
  it("records the previous role and active flag alongside the new ones in the audit row (F-288)", async () => {
    const user = await inviteTestUser("VIEWER", "Audit Role");

    await updateAdminUser(user.id, { name: user.name, role: "CONTENT_EDITOR", active: true }, adminId);
    await updateAdminUser(user.id, { name: user.name, role: "CONTENT_EDITOR", active: false }, adminId);

    const rows = await db.auditLog.findMany({
      where: { entity: "user", entityId: user.id, action: "update" },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(rows.length, 2);
    const [promotion, deactivation] = rows.map(
      (row) =>
        JSON.parse(row.metadata!) as {
          role: string;
          fromRole: string;
          fromActive: boolean;
          changes: Record<string, { from: unknown; to: unknown }>;
        },
    );
    assert.equal(promotion.role, "CONTENT_EDITOR");
    assert.equal(promotion.fromRole, "VIEWER");
    assert.deepEqual(promotion.changes, { role: { from: "VIEWER", to: "CONTENT_EDITOR" } });
    assert.equal(deactivation.fromActive, true);
    assert.deepEqual(deactivation.changes, { active: { from: true, to: false } });
  });

  it("throws UserNotFoundError for an unknown id", async () => {
    await assert.rejects(
      () => updateAdminUser("does-not-exist", { name: "Nobody", role: "VIEWER", active: true }, adminId),
      UserNotFoundError,
    );
  });

  it("refuses self-deactivation and a self role change, with the messages the admin UI shows", async () => {
    await assert.rejects(
      () => updateAdminUser(adminId, { name: "Me", role: "SUPER_ADMIN", active: false }, adminId),
      (err: unknown) => err instanceof UserSelfActionBlockedError && err.message === "Cannot deactivate your own account",
    );
    await assert.rejects(
      () => updateAdminUser(adminId, { name: "Me", role: "VIEWER", active: true }, adminId),
      (err: unknown) => err instanceof UserSelfActionBlockedError && err.message === "Cannot change your own role",
    );
    const me = await db.user.findUnique({ where: { id: adminId }, select: { role: true, active: true } });
    assert.equal(me!.role, "SUPER_ADMIN");
    assert.equal(me!.active, true);
  });

  it("demoting a Super Admin waits for any in-flight change to the Super Admin set (the atomic last-admin guard)", async () => {
    const racer = await inviteTestUser("SUPER_ADMIN", "Race Admin");
    const lock = await holdSuperAdminLock();

    let settled = false;
    let update: Promise<unknown>;
    try {
      update = updateAdminUser(racer.id, { name: racer.name, role: "VIEWER", active: true }, adminId).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(settled, false, "the demotion must wait while another change holds the Super Admin lock");
    } finally {
      await lock.release();
    }

    await update;
    const after = await db.user.findUnique({ where: { id: racer.id }, select: { role: true } });
    assert.equal(after!.role, "VIEWER");
  });

  it("a change that doesn't touch the Super Admin set never waits on that lock", async () => {
    const viewer = await inviteTestUser("VIEWER", "No Lock Needed");
    const lock = await holdSuperAdminLock();

    try {
      const updated = await Promise.race([
        updateAdminUser(viewer.id, { name: "No Lock Needed 2", role: "VIEWER", active: true }, adminId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("blocked on the Super Admin lock")), 2000)),
      ]);
      assert.equal(updated.name, "No Lock Needed 2");
    } finally {
      await lock.release();
    }
  });
});

// F-219: PATCH /api/admin/journeys/[id] on an unknown id crashed with an
// unhandled Prisma P2025 (a 500) instead of answering 404.
describe("updateJourneyStatus (F-219)", () => {
  let adminId: string;
  const createdJourneyIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdJourneyIds.length) {
      await db.customerJourney.deleteMany({ where: { id: { in: createdJourneyIds } } }).catch(() => {});
    }
  });

  it("changes a journey's status and writes an audit row", async () => {
    const unique = randomUUID().slice(0, 8);
    const journey = await db.customerJourney.create({
      data: { name: `Status Test ${unique}`, slug: `status-test-${unique}`, trigger: "newsletter_signup", status: "DRAFT" },
    });
    createdJourneyIds.push(journey.id);

    const updated = await updateJourneyStatus(journey.id, "ACTIVE", adminId);
    assert.equal(updated.status, "ACTIVE");

    const audit = await db.auditLog.findFirst({
      where: { entity: "customer_journey", entityId: journey.id, action: "update_status" },
    });
    assert.ok(audit, "the status change must be audit logged");
  });

  it("throws JourneyNotFoundError (not a raw Prisma error) for an unknown id", async () => {
    await assert.rejects(() => updateJourneyStatus("does-not-exist", "ACTIVE", adminId), JourneyNotFoundError);
  });
});
