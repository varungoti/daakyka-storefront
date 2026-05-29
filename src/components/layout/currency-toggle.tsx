"use client";

import { useCurrency } from "@/context/currency-provider";
import type { SupportedCurrency } from "@/lib/currency/config";
import { cn } from "@/lib/utils";

export function CurrencyToggle() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      className="hidden items-center rounded-full border border-border bg-white/70 p-1 md:flex"
      role="group"
      aria-label="Select currency"
    >
      {(["INR", "USD"] as SupportedCurrency[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setCurrency(option)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-bold transition",
            currency === option
              ? "bg-brand text-white shadow-sm"
              : "text-muted hover:text-brand",
          )}
          aria-pressed={currency === option}
        >
          {option === "INR" ? "₹ INR" : "$ USD"}
        </button>
      ))}
    </div>
  );
}
