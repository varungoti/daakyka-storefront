import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
  titleAs?: "h1" | "h2";
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  titleAs = "h2",
}: SectionHeadingProps) {
  const TitleTag = titleAs;
  return (
    <div
      className={cn(
        "space-y-3",
        align === "center" && "mx-auto max-w-2xl text-center",
        className,
      )}
    >
      {eyebrow && (
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
          {eyebrow}
        </p>
      )}
      <TitleTag className="font-display text-3xl font-bold tracking-tight text-ink md:text-4xl">
        {title}
      </TitleTag>
      {description && (
        <p className="max-w-xl text-base leading-relaxed text-muted">
          {description}
        </p>
      )}
    </div>
  );
}
