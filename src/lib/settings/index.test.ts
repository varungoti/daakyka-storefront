import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import {
  getSetting,
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

// F-222: a DB error used to be caught *inside* the function unstable_cache
// wraps, so the fallback got cached as if it were the real value — for up
// to a year, until an admin happened to save a setting. It's now caught
// only outside the cache boundary, so a failed read never poisons the
// cache: the next read tries the DB again instead of repeating the stale
// fallback. This test can't reach the actual unstable_cache path (that
// needs Next's request/build store, which doesn't exist under plain
// `tsx --test` — getSetting's own uncached fallback branch is what runs
// here, exactly as it does for every other test in this file), but it
// does prove the two things that changed: a failed read still never
// throws to the caller, and it never leaves anything behind that would
// stop the very next read from reflecting a real, current value.
describe("getSetting resilience to a transient DB error", () => {
  it("falls back to the default without throwing, then reflects the DB again once it recovers", async () => {
    const original = db.siteSetting.findUnique;
    let calls = 0;
    // @ts-expect-error - stubbing a Prisma delegate method for the test only.
    db.siteSetting.findUnique = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("simulated transient DB error (connection terminated unexpectedly)");
      }
      return { key: "shipping.flatRate", value: 150 };
    };

    try {
      const duringOutage = await getSetting("shipping.flatRate");
      assert.equal(duringOutage, settingDefaults["shipping.flatRate"]);

      const afterRecovery = await getSetting("shipping.flatRate");
      assert.equal(afterRecovery, 150);
      assert.equal(calls, 2, "the second read must hit the DB again, not repeat a cached failure");
    } finally {
      db.siteSetting.findUnique = original;
    }
  });
});
