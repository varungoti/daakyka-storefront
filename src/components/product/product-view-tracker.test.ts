import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSessionId } from "@/components/product/product-view-tracker";

// F-104: getSessionId is the exact call that used to crash the whole PDP —
// a browser that blocks site storage (Chrome "Don't allow sites to save
// data", iOS Safari "Block All Cookies") throws a SecurityError on the mere
// `window.sessionStorage` property access, and the unguarded version threw
// that out of ProductViewTracker's effect and into the route's error
// boundary. This repo's unit tests run under Node's test runner with no
// DOM, so we drive getSessionId directly with a mocked `window` rather than
// mounting the component (which would need jsdom/RTL to fire the effect).

function setWindow(win: unknown) {
  (globalThis as { window?: unknown }).window = win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("getSessionId", () => {
  it("returns the existing session id from storage without writing to it", () => {
    let setItemCalled = false;
    setWindow({
      sessionStorage: {
        getItem: () => "existing-session-id",
        setItem: () => {
          setItemCalled = true;
        },
      },
    });

    assert.equal(getSessionId(), "existing-session-id");
    assert.equal(setItemCalled, false);
  });

  it("creates and persists a new id when storage has none yet", () => {
    const store = new Map<string, string>();
    setWindow({
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    const id = getSessionId();
    assert.ok(id && id.length > 0);
    assert.equal(store.get("daakyka-session"), id);
  });

  it("never throws when window.sessionStorage itself throws (storage blocked)", () => {
    const win = {};
    Object.defineProperty(win, "sessionStorage", {
      get() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
      configurable: true,
    });
    setWindow(win);

    assert.doesNotThrow(() => getSessionId());
  });

  it("keeps returning the same in-memory id across calls when storage stays blocked", () => {
    const win = {};
    Object.defineProperty(win, "sessionStorage", {
      get() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
      configurable: true,
    });
    setWindow(win);

    const first = getSessionId();
    const second = getSessionId();
    assert.ok(first);
    assert.equal(first, second);
  });
});
