export type SupportedCurrency = "INR" | "USD";

export const DEFAULT_CURRENCY: SupportedCurrency = "INR";

/** Base currency for all stored product prices */
export const BASE_CURRENCY: SupportedCurrency = "INR";

/** INR per 1 USD — override via env in production if needed */
export const USD_TO_INR_RATE = Number(
  process.env.NEXT_PUBLIC_USD_TO_INR_RATE ?? 83,
);

export const CURRENCY_LOCALE: Record<SupportedCurrency, string> = {
  INR: "en-IN",
  USD: "en-US",
};

export const FREE_SHIPPING_THRESHOLD_INR = 8299;

export const PRICE_FILTER_MIN_INR = 2499;
export const PRICE_FILTER_MAX_INR = 10999;
export const PRICE_FILTER_DEFAULT_MAX_INR = 8999;

export const currencyLabels: Record<SupportedCurrency, string> = {
  INR: "₹ INR",
  USD: "$ USD",
};

export const currencySymbols: Record<SupportedCurrency, string> = {
  INR: "₹",
  USD: "$",
};
