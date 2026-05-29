"use client";

import { ProductCard } from "@/components/ui/product-card";
import { useCurrency } from "@/context/currency-provider";
import type { Product } from "@/lib/types";
import { Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 6);
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(q) ||
          product.colorName.toLowerCase().includes(q) ||
          product.category.toLowerCase().includes(q) ||
          product.fabricTech.some((tech) => tech.includes(q.replace(" ", "-"))),
      )
      .slice(0, 8);
  }, [products, query]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close search overlay"
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Search products"
            className="fixed inset-x-4 top-24 z-[70] mx-auto max-w-2xl rounded-[2rem] border border-border bg-white shadow-2xl md:inset-x-auto"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
          >
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <Search className="text-brand" size={20} />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scrubs, colors, fabrics..."
                className="flex-1 bg-transparent text-base outline-none placeholder:text-muted"
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 hover:bg-lilac/50"
                aria-label="Close search"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto p-4">
              {loading ? (
                <p className="px-2 py-8 text-center text-sm text-muted">Searching...</p>
              ) : results.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted">
                  No products found for &ldquo;{query}&rdquo;
                </p>
              ) : (
                <ul className="space-y-2">
                  {results.map((product) => (
                    <li key={product.id}>
                      <Link
                        href={`/products/${product.handle}`}
                        onClick={onClose}
                        className="flex items-center gap-4 rounded-2xl px-3 py-3 transition hover:bg-lavender/40"
                      >
                        <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                          <Image
                            src={product.image}
                            alt={product.name}
                            fill
                            className="object-cover"
                            sizes="56px"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="font-display font-semibold text-ink">{product.name}</p>
                          <p className="text-sm text-muted">{product.colorName}</p>
                        </div>
                        <p className="text-sm font-semibold text-brand">
                          {formatPrice(product.price)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {!loading && query && results.length > 0 && (
                <Link
                  href={`/shop?q=${encodeURIComponent(query)}`}
                  onClick={onClose}
                  className="mt-4 block rounded-2xl bg-lavender/40 px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-lavender/60"
                >
                  View all results for &ldquo;{query}&rdquo;
                </Link>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
