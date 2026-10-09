"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface InteractiveStarRatingProps {
  value: number;
  onChange: (rating: number) => void;
  size?: "sm" | "md" | "lg";
  /** Accessible name of each star button, e.g. "Rate 4 out of 5". */
  labelFor?: (star: number) => string;
}

export function InteractiveStarRating({
  value,
  onChange,
  size = "lg",
  labelFor = (star) => `${star} / 5`,
}: InteractiveStarRatingProps) {
  // Hovering previews the rating a click would give — every star up to the
  // pointer lights, not just the one under it.
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          aria-label={labelFor(star)}
          aria-pressed={star === value}
          className="hover:scale-110 transition-transform"
        >
          <Star
            className={cn(
              sizeClasses[size],
              star <= shown
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}

/** A rating shown, not asked for. */
export function StarRatingDisplay({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${rating} / 5`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            "h-3.5 w-3.5",
            star <= Math.round(rating)
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}
