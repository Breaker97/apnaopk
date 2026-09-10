import { ModernProductCardSkeleton } from "./modern-product-card";

interface ProductSkeletonProps {
  count?: number;
}

export function ProductSkeleton({ count = 9 }: ProductSkeletonProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <ModernProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
