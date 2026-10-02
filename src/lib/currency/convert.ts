import {
  BASE_CURRENCY,
  CURRENCY_LOCALE,
  SupportedCurrency,
  USD_TO_INR_RATE,
} from "@/lib/currency/config";

/**
 * Convert an INR base amount to the display currency.
 *
 * F-014: USD used to be rounded to a whole dollar here and then printed
 * with two decimals ("$2.00" for a ₹149 tie *and* a ₹199 belt, "$4.00" for
 * ₹299), so distinct prices collapsed together and a 20% OFF badge sat
 * beside "$6.00 was $7.00" (14%). Round to the cent instead — the badge's
 * percentage comes from the INR prices, which now agree with what's shown.
 */
export function convertFromBase(
  amountInInr: number,
  target: SupportedCurrency,
): number {
  if (target === BASE_CURRENCY) return amountInInr;
  return roundToMinorUnit(amountInInr / USD_TO_INR_RATE);
}

/** Round to 2 decimals (paise / cents), absorbing float noise such as
 * 199.99 * 3 = 599.9699999999999. */
function roundToMinorUnit(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Convert a display-currency amount back to INR base */
export function convertToBase(
  amount: number,
  source: SupportedCurrency,
): number {
  if (source === BASE_CURRENCY) return amount;
  return Math.round(amount * USD_TO_INR_RATE);
}

export function formatCurrencyAmount(
  amount: number,
  currency: SupportedCurrency,
): string {
  // F-127: INR used to be `maximumFractionDigits: 0`, which showed a stored
  // 638.97 total as "₹639" while Razorpay is charged (and the email says)
  // INR 638.97 — a percentage discount code routinely produces paise. Show
  // them, but only when there are any, so whole-rupee prices stay "₹1,099".
  // USD always prints its cents.
  const rounded = roundToMinorUnit(amount);
  const showMinorUnits = currency !== "INR" || !Number.isInteger(rounded);
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency], {
    style: "currency",
    currency,
    minimumFractionDigits: showMinorUnits ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

/** Format a price stored in INR for the selected display currency */
export function formatBasePrice(
  amountInInr: number,
  displayCurrency: SupportedCurrency,
): string {
  const displayAmount = convertFromBase(amountInInr, displayCurrency);
  return formatCurrencyAmount(displayAmount, displayCurrency);
}

export function formatFreeShippingThreshold(
  displayCurrency: SupportedCurrency,
  thresholdInInr: number,
): string {
  return formatBasePrice(thresholdInInr, displayCurrency);
}
