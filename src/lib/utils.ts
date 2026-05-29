import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { SupportedCurrency } from "@/lib/currency/config";
import { DEFAULT_CURRENCY } from "@/lib/currency/config";
import { formatCurrencyAmount } from "@/lib/currency/convert";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** @deprecated Prefer useCurrency().formatPrice for display — this is for server/static use */
export function formatPrice(
  amount: number,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
) {
  return formatCurrencyAmount(amount, currency);
}
