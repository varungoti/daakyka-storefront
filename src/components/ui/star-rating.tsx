import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

interface StarRatingProps {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  className?: string;
}

export function StarRating({
  rating,
  reviewCount,
  size = "sm",
  className,
}: StarRatingProps) {
  const iconSize = size === "sm" ? 14 : 18;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={index}
            size={iconSize}
            className={cn(
              index < Math.round(rating)
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-gray-300",
            )}
          />
        ))}
      </div>
      <span className="text-sm font-medium text-ink">{rating.toFixed(1)}</span>
      {reviewCount !== undefined && (
        <span className="text-sm text-muted">({reviewCount})</span>
      )}
    </div>
  );
}
