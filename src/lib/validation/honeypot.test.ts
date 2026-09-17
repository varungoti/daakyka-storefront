import { describe, it } from "node:test";
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
