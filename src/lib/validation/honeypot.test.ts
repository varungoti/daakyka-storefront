import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { HONEYPOT_FIELD_NAME, isHoneypotTripped } from "@/lib/validation/honeypot";

describe("isHoneypotTripped", () => {
  it("is false when the field is absent", () => {
    assert.equal(isHoneypotTripped({ name: "Real Person" }), false);
  });

  it("is false when the field is an empty string", () => {
    assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD_NAME]: "" }), false);
  });

  it("is false when the field is only whitespace", () => {
    assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD_NAME]: "   " }), false);
  });

  it("is true when a bot fills the field in", () => {
    assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD_NAME]: "http://spam.example" }), true);
  });

  it("handles non-object input without throwing", () => {
    assert.doesNotThrow(() => isHoneypotTripped(null));
    assert.doesNotThrow(() => isHoneypotTripped("a string"));
    assert.equal(isHoneypotTripped(null), false);
  });
});

// F-157: "company_website" matched Chrome's address-autofill heuristics for
// an Organization field, so a real buyer's autofill could trip the honeypot
// and silently lose their lead.
describe("HONEYPOT_FIELD_NAME (F-157)", () => {
  it("is not a name any autofill / password-manager heuristic would recognise", () => {
    assert.match(HONEYPOT_FIELD_NAME, /^[a-z0-9_]+$/);
    assert.doesNotMatch(
      HONEYPOT_FIELD_NAME,
      /company|org|website|url|site|name|email|mail|phone|tel|address|addr|city|zip|postal|user|pass|card|first|last|title|job/i,
    );
  });

  it("no longer trips on the old, autofill-prone field name", () => {
    assert.equal(isHoneypotTripped({ company_website: "Acme Hospitals" }), false);
  });
});

describe("isHoneypotTripped logging (F-157)", () => {
  it("logs the source (never the payload) when tripped, so false positives are visible", () => {
    const warn = mock.method(console, "warn", () => {});
    try {
      assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD_NAME]: "http://spam.example/secret" }, "contact"), true);
      assert.equal(warn.mock.callCount(), 1);
      const logged = String(warn.mock.calls[0].arguments[0]);
      assert.match(logged, /honeypot/);
      assert.match(logged, /contact/);
      assert.ok(!logged.includes("spam.example"));
    } finally {
      warn.mock.restore();
    }
  });

  it("does not log when the honeypot is empty or absent", () => {
    const warn = mock.method(console, "warn", () => {});
    try {
      isHoneypotTripped({ name: "Real Person" }, "contact");
      isHoneypotTripped({ [HONEYPOT_FIELD_NAME]: "  " }, "contact");
      assert.equal(warn.mock.callCount(), 0);
    } finally {
      warn.mock.restore();
    }
  });
});
