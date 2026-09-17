import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { POST as postContact } from "@/app/api/contact/route";
import { POST as postBulkOrder } from "@/app/api/bulk-orders/route";
import { POST as postNewsletter } from "@/app/api/newsletter/subscribe/route";
import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";
import { db } from "@/lib/db";

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("honeypot spam guard", () => {
  after(async () => {
    await db.contactEnquiry.deleteMany({ where: { email: "honeypot-bot@example.com" } });
    await db.bulkOrderLead.deleteMany({ where: { email: "honeypot-bot@example.com" } });
    await db.newsletterSubscriber.deleteMany({ where: { email: "honeypot-bot@example.com" } });
  });

  it("contact: reports success but never creates a record when tripped", async () => {
    const response = await postContact(
      jsonRequest("http://localhost/api/contact", {
        name: "Bot",
        email: "honeypot-bot@example.com",
        message: "This should never be stored anywhere at all.",
        [HONEYPOT_FIELD_NAME]: "http://spam.example",
      }),
    );
    assert.equal(response.status, 200);
    const stored = await db.contactEnquiry.findFirst({
      where: { email: "honeypot-bot@example.com" },
    });
    assert.equal(stored, null);
  });

  it("bulk-orders: reports success but never creates a record when tripped", async () => {
    const response = await postBulkOrder(
      jsonRequest("http://localhost/api/bulk-orders", {
        organization: "Spam Org",
        contactPerson: "Bot",
        email: "honeypot-bot@example.com",
        phone: "1234567890",
        consentGiven: true,
        [HONEYPOT_FIELD_NAME]: "http://spam.example",
      }),
    );
    assert.equal(response.status, 200);
    const stored = await db.bulkOrderLead.findFirst({
      where: { email: "honeypot-bot@example.com" },
    });
    assert.equal(stored, null);
  });

  it("newsletter: reports success but never creates a subscriber when tripped", async () => {
    const response = await postNewsletter(
      jsonRequest("http://localhost/api/newsletter/subscribe", {
        email: "honeypot-bot@example.com",
        consentGiven: true,
        [HONEYPOT_FIELD_NAME]: "http://spam.example",
      }),
    );
    assert.equal(response.status, 200);
    const stored = await db.newsletterSubscriber.findUnique({
      where: { email: "honeypot-bot@example.com" },
    });
    assert.equal(stored, null);
  });
});
