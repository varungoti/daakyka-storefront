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

export function TrustBar() {
  const { freeShippingLabel } = useCurrency();

  const descriptions = trustItems.map((item, index) => {
    if (index === 0) return `On orders over ${freeShippingLabel}`;
    return item.description;
  });

  return (
    <section className="border-y border-border bg-lavender/50 py-8">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 md:grid-cols-5 lg:px-8">
        {trustItems.map((item, index) => {
          const Icon = icons[index];
          return (
            <div key={item.title} className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
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
