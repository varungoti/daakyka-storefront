import assert from "node:assert/strict";
import { it } from "node:test";
import { loadRazorpayCheckoutScript } from "./load-razorpay-script";

it("removes a failed script and shares one fresh attempt on retry", async (context) => {
  const append = context.mock.fn();
  const remove = context.mock.fn();
  const makeScript = () => ({ onload: null as (() => void) | null, onerror: null as (() => void) | null, remove });
  const blocked = makeScript();
  const healthy = makeScript();
  const scripts = [blocked, healthy];
  const fakeWindow: { Razorpay?: object } = {};
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => scripts.shift(), body: { appendChild: append } },
  });
  try {
    const first = loadRazorpayCheckoutScript();
    blocked.onerror?.();
    await assert.rejects(first, /Failed to load Razorpay/);
    assert.equal(remove.mock.callCount(), 1);

    const next = loadRazorpayCheckoutScript();
    assert.equal(loadRazorpayCheckoutScript(), next);
    fakeWindow.Razorpay = {};
    healthy.onload?.();
    await next;
    assert.equal(append.mock.callCount(), 2);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
});
