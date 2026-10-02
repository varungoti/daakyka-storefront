/**
 * Accessible names for storefront controls whose visible content is only an
 * icon, a number or a generic verb. A listing renders dozens of the same
 * button, so each name carries the product it acts on. Every name still
 * starts with the control's visible text, so voice-control users who say
 * what they see get the right button (WCAG 2.5.3 Label in Name).
 */

/** "Cart" + 2 -> "Cart, 2 items". The badge inside an icon button is not part
 * of its `aria-label`, so the count has to be folded into the name. */
export function countedLabel(label: string, count: number | undefined): string {
  if (count === undefined || count <= 0) return label;
  return `${label}, ${count} item${count === 1 ? "" : "s"}`;
}

/** The heart toggle on a product card / PDP: "Add Kids Hoodie to wishlist". */
export function wishlistToggleLabel(productName: string, active: boolean): string {
  return active ? `Remove ${productName} from wishlist` : `Add ${productName} to wishlist`;
}

/** The Quick Add button on a product card, whose visible text is just
 * "Quick Add" / "Added" / "Sold out". */
export function quickAddLabel(
  productName: string,
  size: string,
  state: "idle" | "added" | "soldOut",
): string {
  if (state === "added") return `Added ${productName} to cart`;
  if (state === "soldOut") return `Sold out: ${productName}, size ${size}`;
  return `Quick Add ${productName}, size ${size}`;
}
