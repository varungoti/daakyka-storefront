"use client";

import { useCurrency } from "@/context/currency-provider";
import type { SupportedCurrency } from "@/lib/currency/config";
import { cn } from "@/lib/utils";

export function CurrencyToggle({ className }: { className?: string }) {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      // F-009: no `hidden ... md:flex` here anymore — this component used
      // to hide itself below 768px no matter where it was placed, which
      // silently broke the copy MobileNavDrawer renders in its footer.
      // Callers that only want it on desktop (the header) wrap this in
      // their own `hidden md:block`, same as before.
      className={cn("flex items-center rounded-full border border-border bg-surface-muted p-1", className)}
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
