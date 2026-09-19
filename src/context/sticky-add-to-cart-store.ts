/**
 * Tiny external store (same `useSyncExternalStore` shape as
 * src/context/cart-store.ts) so the floating WhatsApp bubble — rendered
 * high up in the tree in src/components/layout/site-shell.tsx — can react
 * to the PDP's mobile sticky Add-to-Cart bar — rendered deep inside
 * src/components/product/product-detail.tsx — without prop drilling or a
 * new context provider (release-hardening storefront-ux F6/F10: the bar
 * must not fight the WhatsApp bubble for the same corner of the screen).
 *
 * Purely in-memory, no persistence: this is ephemeral view state (“is the
 * sticky bar currently on screen”), not something that should survive a
 * reload or leak across page views.
 */

let visible = false;
const listeners = new Set<() => void>();

export function getStickyAddToCartVisible(): boolean {
  return visible;
}

export function getServerStickyAddToCartVisible(): boolean {
  return false;
}

export function setStickyAddToCartVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  for (const listener of listeners) listener();
}

export function subscribeStickyAddToCartVisible(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
