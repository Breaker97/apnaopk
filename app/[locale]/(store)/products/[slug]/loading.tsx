import { Skeleton } from "@/components/ui/skeleton";
import {
  ProductDetailsSkeleton,
  ReviewsSkeleton,
  RelatedProductsSkeleton,
} from "@/components/products/product-details-skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// the product query + metadata. Mirrors the page layout so content swaps in
// with minimal layout shift. Skeleton dimensions are shared with the real
// sections via product-details-skeleton.
export default function ProductDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8 lg:py-10" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading product...
      </p>

      {/* Breadcrumb — Home / Products / Category / Product name. */}
      <Skeleton className="mb-6 h-5 w-80 max-w-full" />

      <ProductDetailsSkeleton />

      <section className="mt-12">
        <ReviewsSkeleton />
      </section>

      <section className="mt-12 border-t border-border/70 py-12">
        <Skeleton className="mb-8 h-6 w-44" />
        <RelatedProductsSkeleton />
      </section>
    </div>
  );
}
