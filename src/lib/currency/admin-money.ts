/**
 * F-202 fix (release-hardening admin-order-list-detail-ux): every admin
 * money formatter in the orders/customers area used
 * `maximumFractionDigits: 0`, which silently rounds a fractional rupee
 * amount to the nearest whole rupee. Real orders *do* carry paise — a
 * percentage discount code (see src/lib/discounts/index.ts's `roundMoney`,
 * 2dp) routinely produces one, e.g. 10% off ₹479 is ₹47.90, and Razorpay
 * is charged (and the DB stores) the exact 2-decimal total — so a
 * dashboard showing "₹530" for an order actually charged ₹530.10 is
 * showing the admin the wrong number, not just a cosmetic rounding.
 *
 * Deliberately separate from `formatCurrencyAmount` in
 * src/lib/currency/convert.ts, which is the storefront's multi-currency
 * (INR/USD) display formatter and must keep INR's existing
 * `maximumFractionDigits: 0` behaviour there — this is INR-only, admin-only,
 * and always exact.
 */
export function formatInrExact(amount: number, options: { alwaysShowPaise?: boolean } = {}): string {
  // Round to the nearest paisa first — floating-point line-item math
  // (e.g. `unitPrice * quantity`) can land a hair off a clean 2dp value
  // (199.99 * 3 = 599.9699999999999), and Intl would otherwise render
  // that as a misleading 3rd decimal instead of the correct ₹599.97.
  const rounded = Math.round(amount * 100) / 100;
  const showPaise = options.alwaysShowPaise || !Number.isInteger(rounded);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}
