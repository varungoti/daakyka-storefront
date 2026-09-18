import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "outline" | "luxury" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-sm hover:bg-brand-violet",
  outline: "border border-ink/30 bg-transparent text-ink hover:bg-ink/5 hover:border-ink",
  luxury: "bg-ink text-white hover:bg-ink/90",
  ghost: "text-brand hover:bg-lilac/50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-sm",
  lg: "px-8 py-4 text-base",
};

/**
 * Shared with any non-<button> element that needs to look like a Button —
 * most commonly a `<Link>` used as a call-to-action. Several components
 * used to wrap `<Button>` in `<Link>`, producing an invalid (and an
 * axe/a11y "nested interactive controls") `<a><button>...</button></a>`.
 * Using `buttonClassNames` on the `<Link>` directly instead gives the same
 * look with a single interactive element.
 */
export function buttonClassNames({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonClassNames({ variant, size, className })}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
