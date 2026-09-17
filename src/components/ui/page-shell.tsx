import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Standard page hero band — clean, light header used across the storefront */
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
      className={cn("border-b border-border bg-alt-surface py-12 md:py-16", className)}
    >
      <div className={cn("mx-auto max-w-[1320px] px-4 lg:px-8", innerClassName)}>{children}</div>
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
      ? "bg-alt-surface"
      : variant === "mix"
        ? "bg-alt-surface"
        : "bg-background";

  return (
    <section className={cn(bg, "py-12 md:py-16", className)}>
      <div className={cn("mx-auto max-w-[1320px] px-4 lg:px-8", innerClassName)}>{children}</div>
    </section>
  );
}
