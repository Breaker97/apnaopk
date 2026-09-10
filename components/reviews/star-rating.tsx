"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface InteractiveStarRatingProps {
  value: number;
  onChange: (rating: number) => void;
  size?: "sm" | "md" | "lg";
}

export function InteractiveStarRating({
  value,
  onChange,
  size = "lg",
}: InteractiveStarRatingProps) {
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="hover:scale-110 transition-transform"
        >
          <Star
            className={cn(
              sizeClasses[size],
              star <= value
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30 hover:text-yellow-400"
            )}
          />
        </button>
      ))}
    </div>
  );
}
