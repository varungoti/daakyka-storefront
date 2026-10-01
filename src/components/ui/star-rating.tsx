import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

interface StarRatingProps {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  className?: string;
  /** For cards only ~140px wide (the 2-column phone listing grid): below
   * `sm` the row of five stars becomes one star followed by the number and
   * the review count, in smaller type — about 75px instead of about 135px,
   * which is wider than the whole content area of a phone-width card. From
   * `sm` up it is the normal row of five. */
  condenseOnPhone?: boolean;
}

export function StarRating({
  rating,
  reviewCount,
  size = "sm",
  className,
  condenseOnPhone = false,
}: StarRatingProps) {
  const iconSize = size === "sm" ? 14 : 18;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className={cn("flex items-center gap-0.5", condenseOnPhone && "max-sm:hidden")}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={index}
            size={iconSize}
            className={cn(
              index < Math.round(rating)
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-star-empty",
            )}
          />
        ))}
      </div>
      {condenseOnPhone && <Star size={iconSize} className="fill-amber-400 text-amber-400 sm:hidden" />}
      <span className={cn("text-sm font-medium text-ink", condenseOnPhone && "max-sm:text-xs")}>
        {rating.toFixed(1)}
      </span>
      {reviewCount !== undefined && (
        <span className={cn("text-sm text-muted", condenseOnPhone && "max-sm:text-xs")}>({reviewCount})</span>
      )}
    </div>
  );
}
