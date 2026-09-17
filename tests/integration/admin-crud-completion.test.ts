import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

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
import { POST as sendTestTemplateRoute } from "@/app/api/admin/templates/[id]/send-test/route";

import { createOffer, deleteOffer, getOfferForAdmin, OfferNotFoundError, updateOffer } from "@/lib/offers";
import { GET as getOffers, POST as postOffer } from "@/app/api/admin/offers/route";
import { DELETE as deleteOfferRoute, GET as getOffer, PATCH as patchOffer } from "@/app/api/admin/offers/[id]/route";

import {
  createSeoRecord,
  deleteSeoRecord,
  getSeoRecordForAdmin,
  SeoPagePathConflictError,
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
  deleteUser,
  inviteUser,
  LastSuperAdminError,
  resetUserPassword,
  UserDeleteBlockedError,
  UserEmailConflictError,
  UserNotFoundError,
  UserSelfActionBlockedError,
} from "@/lib/auth/user-admin";
import { POST as postUser } from "@/app/api/admin/users/route";
import { DELETE as deleteUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/reset-password/route";

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

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

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

  it("deleteTemplate is blocked while a campaign references it", async () => {
    const unique = randomUUID().slice(0, 8);
    const template = await createTemplate({ name: `Referenced ${unique}`, channel: "EMAIL", body: "Body content here" }, adminId);
    createdIds.push(template.id);

    const campaign = await db.campaign.create({
      data: { name: `Campaign ${unique}`, channel: "EMAIL", status: "SENT", templateId: template.id },
    });
    createdCampaignIds.push(campaign.id);

    await assert.rejects(() => deleteTemplate(template.id, adminId), TemplateDeleteBlockedError);

    await db.campaign.delete({ where: { id: campaign.id } });
    createdCampaignIds.splice(createdCampaignIds.indexOf(campaign.id), 1);
    await deleteTemplate(template.id, adminId);
    createdIds.splice(createdIds.indexOf(template.id), 1);
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

  it("full round trip: create -> read -> update -> delete", async () => {
    const unique = randomUUID().slice(0, 8);
    const record = await createSeoRecord(
      { path: `/test-seo-${unique}`, title: "Test Page", metaDescription: "A test meta description." },
      adminId,
    );
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

  it("createSeoRecord rejects a path already in use", async () => {
    const unique = randomUUID().slice(0, 8);
    const path = `/test-seo-dup-${unique}`;
    const first = await createSeoRecord({ path, title: "First", metaDescription: "First description." }, adminId);
    createdIds.push(first.id);

    await assert.rejects(
      () => createSeoRecord({ path, title: "Second", metaDescription: "Second description." }, adminId),
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
  });

  it("resetUserPassword throws UserNotFoundError for an unknown id", async () => {
    await assert.rejects(() => resetUserPassword("does-not-exist", adminId), UserNotFoundError);
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
  });
});
