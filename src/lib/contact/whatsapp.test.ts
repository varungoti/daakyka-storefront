import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { whatsappHref } from "@/lib/contact/whatsapp";

describe("whatsappHref", () => {
  it("strips spaces and the leading + from the phone number", () => {
    assert.equal(
      whatsappHref("+91 95530 94251", "hi"),
      "https://wa.me/919553094251?text=hi",
    );
  });

  it("strips any other non-digit punctuation too", () => {
    assert.equal(
      whatsappHref("+91-95530-94251", "hi"),
      "https://wa.me/919553094251?text=hi",
    );
  });

  it("URL-encodes the message", () => {
    assert.equal(
      whatsappHref("919553094251", "Hi DAAKYKA, I'd like to enquire!"),
      "https://wa.me/919553094251?text=Hi%20DAAKYKA%2C%20I'd%20like%20to%20enquire!",
    );
  });

  // F-002/F-126: a numberless `wa.me/?text=` link is exactly the bug this
  // helper fixes (it opens WhatsApp's "choose a contact" picker instead of
  // a chat with the business), so every real caller must supply digits.
  // This only documents the degrade-safe fallback for an unexpected empty
  // setting, not a case any caller should rely on.
  it("falls back to a numberless link only when no digits remain", () => {
    assert.equal(whatsappHref("", "hi"), "https://wa.me/?text=hi");
    assert.equal(whatsappHref("n/a", "hi"), "https://wa.me/?text=hi");
  });
});
