import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getCartIdSnapshot, getCartSnapshot, getServerCartSnapshot, setCartState, subscribeToCart } from "./cart-store";

const line = {
  id: "local-line-blue", variantId: "blue", productHandle: "hoodie",
  productTitle: "Hoodie", variantTitle: "Blue", price: 125, quantity: 2,
  image: "/hoodie.webp", maxQuantity: 4,
};
const cart = { id: "local-a", lines: [line], subtotal: 250, totalQuantity: 2, currencyCode: "INR" };

describe("rehydrating a returning shopper's cart", () => {
  let values: Map<string, string>;
  let events: EventTarget;
  let unsubscribe: () => void;
  let previous: PropertyDescriptor | undefined;
  let changes: number;
  const signal = (key: string | null) => events.dispatchEvent(Object.assign(new Event("storage"), { key }));

  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    events = new EventTarget();
    values = new Map();
    changes = 0;
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(events, { localStorage: storage }) });
    unsubscribe = subscribeToCart(() => { changes++; });
    signal("daakyka-cart");
  });
  afterEach(() => {
    unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("can render the checkout line list and add again after an unreadable saved cart", () => {
    for (const raw of ["null", "{}", "false", "[]", "{", '{"lines":"retired"}']) {
      values.set("daakyka-cart", raw);
      signal("daakyka-cart");
      assert.deepEqual(getCartSnapshot().lines.map((item) => item.variantId), []);
      assert.strictEqual(getCartSnapshot(), getCartSnapshot());
    }
    setCartState({ cart, cartId: cart.id });
    assert.deepEqual(getCartSnapshot(), cart);
    assert.equal(getCartIdSnapshot(), cart.id);
  });

  it("keeps the usable lines and recomputes totals instead of trusting damaged rows or stale totals", () => {
    values.set("daakyka-cart", JSON.stringify({ ...cart, totalQuantity: 99, subtotal: 9000,
      lines: [null, { ...line, id: "stale", quantity: -1 }, line] }));
    assert.deepEqual(getCartSnapshot(), cart);
    assert.deepEqual(getServerCartSnapshot().lines, []);
  });

  it("refreshes both snapshots after a different tab clears all local storage", () => {
    setCartState({ cart, cartId: cart.id });
    const before = changes;
    values.clear();
    signal(null);
    assert.equal(changes, before + 1);
    assert.deepEqual(getCartSnapshot().lines, []);
    assert.equal(getCartIdSnapshot(), "");
    const after = changes;
    signal("another-setting");
    assert.equal(changes, after);
  });
});
