import {
  BASE_CURRENCY,
  CURRENCY_LOCALE,
  SupportedCurrency,
  USD_TO_INR_RATE,
} from "@/lib/currency/config";

/** Convert an INR base amount to the display currency */
export function convertFromBase(
  amountInInr: number,
  target: SupportedCurrency,
): number {
  if (target === BASE_CURRENCY) return amountInInr;
  return Math.round(amountInInr / USD_TO_INR_RATE);
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
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "INR" ? 0 : 2,
  }).format(amount);
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
