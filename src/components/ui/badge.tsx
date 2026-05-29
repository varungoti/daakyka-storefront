import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "new" | "bestseller";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
        variant === "default" && "bg-lilac text-brand",
        variant === "new" && "bg-brand text-white",
        variant === "bestseller" && "bg-brand text-white shadow-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}
