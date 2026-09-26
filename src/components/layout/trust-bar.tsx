"use client";

import { useCurrency } from "@/context/currency-provider";
import { trustItems } from "@/data/navigation";
import {
  CreditCard,
  Headphones,
  Package,
  RefreshCw,
  Truck,
} from "lucide-react";

const icons = [Truck, RefreshCw, Package, CreditCard, Headphones];

/**
 * F-008 fix: index 0 ("Free Shipping") and index 1 ("Easy Returns") used to
 * be hard-coded strings ("On orders over ₹8,299", "30-day return policy")
 * that could silently drift from what checkout and the PDP actually
 * promise. `freeShippingLabel` comes from CurrencyProvider (fed by the
 * `shipping.freeAbove` setting); `returnWindowDays` is the same
 * `returns.windowDays` setting the PDP, /returns and /terms already render
 * (see settings/index.ts's F-026 note). Pulled out as a pure function so
 * this mapping is unit-testable without rendering the component (this repo
 * has no jsdom/React Testing Library — see trust-bar.test.ts).
 */
export function computeTrustItemDescriptions(
  freeShippingLabel: string,
  returnWindowDays: number,
): string[] {
  return trustItems.map((item, index) => {
    if (index === 0) return `On orders over ${freeShippingLabel}`;
    if (index === 1) return `${returnWindowDays}-day return policy`;
    return item.description;
  });
}

export function TrustBar({ returnWindowDays }: { returnWindowDays: number }) {
  const { freeShippingLabel } = useCurrency();
  const descriptions = computeTrustItemDescriptions(freeShippingLabel, returnWindowDays);

  return (
    <section className="border-y border-border bg-alt-surface py-8">
      <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-6 px-4 md:grid-cols-5 lg:px-8">
        {trustItems.map((item, index) => {
          const Icon = icons[index];
          return (
            <div key={item.title} className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated shadow-sm">
                <Icon className="text-brand" size={22} />
              </div>
              <p className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-muted">{descriptions[index]}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
