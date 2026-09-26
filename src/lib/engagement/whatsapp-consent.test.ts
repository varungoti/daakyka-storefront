import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasWhatsAppMarketingConsent, normalizeWhatsAppPhone } from "@/lib/engagement/whatsapp-consent";

/**
 * F-266/F-317 fix: normalizeWhatsAppPhone is what a WATI send and the
 * WhatsAppOptIn consent lookup both key on — a read and a write of the same
 * real-world number must always agree, or the consent gate in
 * campaign-dispatcher.ts/journey-engine.ts would silently never match a
 * real opt-in row.
 */

describe("normalizeWhatsAppPhone", () => {
  it("adds the 91 country code to a bare 10-digit Indian mobile number", () => {
    assert.equal(normalizeWhatsAppPhone("9876543210"), "919876543210");
  });

  it("normalises common human-typed formats to the same key", () => {
    const expected = "919876543210";
    assert.equal(normalizeWhatsAppPhone("98765 43210"), expected);
    assert.equal(normalizeWhatsAppPhone("+91 98765 43210"), expected);
    assert.equal(normalizeWhatsAppPhone("0-98765-43210"), expected);
    assert.equal(normalizeWhatsAppPhone("919876543210"), expected);
  });

  it("passes through a plausible international number unchanged", () => {
    // UK number, not a recognisable Indian mobile — kept as-is (already
    // carries its own country code).
    assert.equal(normalizeWhatsAppPhone("+44 20 7946 0958"), "442079460958");
  });

  it("rejects a number that is neither a valid Indian mobile nor a full international number", () => {
    assert.equal(normalizeWhatsAppPhone("12345"), null);
    assert.equal(normalizeWhatsAppPhone("0123456789"), null); // leading 0, too short to be a trunk-prefixed 10-digit number
    assert.equal(normalizeWhatsAppPhone(""), null);
  });
});

describe("hasWhatsAppMarketingConsent", () => {
  const createdPhones: string[] = [];

  after(async () => {
    if (createdPhones.length > 0) {
      await db.whatsAppOptIn.deleteMany({ where: { phone: { in: createdPhones } } }).catch(() => {});
    }
  });

  function testPhone(): string {
    // Unique 10-digit Indian mobile number per test run: a leading 9 (a
    // valid TRAI mobile prefix) plus 9 more digits pulled from a fresh
    // UUID's numeric characters, padded out if too few of them were digits.
    const suffix = randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "1");
    return `9${suffix}`;
  }

  it("is false for a phone with no WhatsAppOptIn row at all", async () => {
    assert.equal(await hasWhatsAppMarketingConsent(testPhone()), false);
  });

  it("is false for undefined/empty input", async () => {
    assert.equal(await hasWhatsAppMarketingConsent(undefined), false);
    assert.equal(await hasWhatsAppMarketingConsent(""), false);
  });

  it("is true for a phone with an opted-in, not-opted-out row — matched regardless of input formatting", async () => {
    const rawPhone = testPhone();
    const normalized = normalizeWhatsAppPhone(rawPhone)!;
    createdPhones.push(normalized);
    await db.whatsAppOptIn.create({ data: { phone: normalized } });

    assert.equal(await hasWhatsAppMarketingConsent(rawPhone), true);
    // A differently-formatted (but same underlying number) lookup must
    // resolve to the same row.
    assert.equal(await hasWhatsAppMarketingConsent(`+91 ${rawPhone}`), true);
  });

  it("is false once optedOutAt is set", async () => {
    const rawPhone = testPhone();
    const normalized = normalizeWhatsAppPhone(rawPhone)!;
    createdPhones.push(normalized);
    await db.whatsAppOptIn.create({ data: { phone: normalized, optedOutAt: new Date() } });

    assert.equal(await hasWhatsAppMarketingConsent(rawPhone), false);
  });
});
