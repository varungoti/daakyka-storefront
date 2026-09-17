import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSettingKey,
  settingDefaults,
  settingSchemas,
  type SettingKey,
} from "@/lib/settings/index";

describe("settings defaults", () => {
  it("has a default for every setting key", () => {
    const keys = Object.keys(settingSchemas) as SettingKey[];
    for (const key of keys) {
      assert.ok(key in settingDefaults, `missing default for ${key}`);
    }
  });

  it("every default value passes its own schema", () => {
    for (const key of Object.keys(settingDefaults) as SettingKey[]) {
      const result = settingSchemas[key].safeParse(settingDefaults[key]);
      assert.equal(result.success, true, `default for ${key} should be valid`);
    }
  });

  it("boolean page toggles default to disabled", () => {
    assert.equal(settingDefaults["pages.fabricTech.enabled"], false);
    assert.equal(settingDefaults["pages.mixMatch.enabled"], false);
  });

  it("sale and bulk CTA default to enabled", () => {
    assert.equal(settingDefaults["sale.enabled"], true);
    assert.equal(settingDefaults["header.bulkCta.enabled"], true);
  });

  it("contact defaults match the real business details", () => {
    assert.equal(settingDefaults["contact.phone"], "+91 95530 94251");
    assert.equal(settingDefaults["contact.whatsapp"], "+91 95530 94251");
    assert.equal(settingDefaults["contact.email"], "daakykaapparels@gmail.com");
    assert.match(settingDefaults["contact.address"], /Kavuri Hills/);
  });
});

describe("isSettingKey", () => {
  it("accepts every known key", () => {
    for (const key of Object.keys(settingDefaults)) {
      assert.equal(isSettingKey(key), true);
    }
  });

  it("rejects unknown keys", () => {
    assert.equal(isSettingKey("not.a.real.key"), false);
    assert.equal(isSettingKey(""), false);
    assert.equal(isSettingKey("pages.fabricTech"), false);
  });
});

describe("setting validation", () => {
  it("rejects non-boolean values for boolean keys", () => {
    assert.equal(settingSchemas["sale.enabled"].safeParse("yes").success, false);
    assert.equal(settingSchemas["pages.mixMatch.enabled"].safeParse(1).success, false);
  });

  it("rejects an invalid contact email", () => {
    assert.equal(settingSchemas["contact.email"].safeParse("not-an-email").success, false);
  });

  it("rejects negative shipping numbers", () => {
    assert.equal(settingSchemas["shipping.flatRate"].safeParse(-5).success, false);
    assert.equal(settingSchemas["shipping.freeAbove"].safeParse(-1).success, false);
  });

  it("rejects an empty announcement list", () => {
    assert.equal(settingSchemas["announcement.messages"].safeParse([]).success, false);
  });

  it("accepts a valid announcement list", () => {
    const result = settingSchemas["announcement.messages"].safeParse(["Free shipping", "Sale on"]);
    assert.equal(result.success, true);
  });
});
