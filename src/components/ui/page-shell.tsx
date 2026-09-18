import { cn } from "@/lib/utils";
import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Standard page hero band — clean, light header used across the
 * storefront. `image` (Phase E2: a manifest-slot lookup via
 * `getSiteImage`, e.g. `about.hero`/`bulk-orders.hero`/`contact.banner`)
 * renders as a full-bleed background photo behind the content with a
 * light scrim so text stays readable; omit it for the plain text-only
 * band most pages already use.
 */
export function PageHeroBand({
  children,
  className,
  innerClassName,
  image,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  image?: { url: string; alt: string } | null;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden border-b border-border bg-alt-surface py-12 md:py-16",
        className,
      )}
    >
      {image ? (
        <>
          <Image
            src={image.url}
            alt={image.alt}
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-white/78" aria-hidden />
        </>
      ) : null}
      <div className={cn("relative mx-auto max-w-[1320px] px-4 lg:px-8", innerClassName)}>
        {children}
      </div>
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
