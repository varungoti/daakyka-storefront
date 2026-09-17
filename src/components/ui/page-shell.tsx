import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Standard page hero band — theme-aware gradient header used across the storefront */
export function PageHeroBand({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <section
      className={cn("border-b border-border bg-section-page-header py-16 md:py-20", className)}
    >
      <div className={cn("mx-auto max-w-7xl px-4 lg:px-8", innerClassName)}>{children}</div>
    </section>
  );
}

/** Standard content section below a page hero */
export function PageContentSection({
  children,
  className,
  variant = "default",
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  variant?: "default" | "alt" | "mix";
}) {
  const bg =
    variant === "alt"
      ? "bg-section-alt"
      : variant === "mix"
        ? "bg-section-mix"
        : "bg-background";

  return (
    <section className={cn(bg, "py-16 md:py-20", className)}>
      <div className={cn("mx-auto max-w-7xl px-4 lg:px-8", innerClassName)}>{children}</div>
    </section>
  );
}
