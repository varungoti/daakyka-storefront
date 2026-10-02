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

export const currencyLabels: Record<SupportedCurrency, string> = {
  INR: "₹ INR",
  USD: "$ USD",
};

export const currencySymbols: Record<SupportedCurrency, string> = {
  INR: "₹",
  USD: "$",
};
