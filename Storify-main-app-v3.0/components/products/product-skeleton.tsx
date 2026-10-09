import { ModernProductCardSkeleton } from "./modern-product-card";
import { CARD_GRID_GAP } from "@/components/store/product-grid-columns";
import { cn } from "@/lib/utils";

interface ProductSkeletonProps {
  count?: number;
  /** Column overrides matching the grid it stands in for. */
  className?: string;
}

export function ProductSkeleton({ count = 9, className }: ProductSkeletonProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
        CARD_GRID_GAP,
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <ModernProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
