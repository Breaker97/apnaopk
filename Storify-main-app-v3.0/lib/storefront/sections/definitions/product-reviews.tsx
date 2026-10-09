import { Suspense } from "react";
import { ReviewsSkeleton } from "@/components/products/product-details-skeleton";
import { ReviewsListLazy as ReviewsList } from "@/components/reviews/reviews-list-lazy";
import type { SectionDefinition } from "../types";

/**
 * The product page's review thread (`#reviews` — the buy box's rating link
 * and review notifications deep-link to it). Hideable and reorderable but a
 * singleton: two lists would double-post the anchor.
 *
 * ONE design (Figma 829-2420) — like product-main, the thread's look is not
 * a per-instance choice. The summary, filters, pagination and the
 * write-a-review flow all live in `ReviewsList`; it draws its own title, so
 * this section must never add one (that shipped a duplicate "Reviews"
 * heading once).
 */
export const productReviews: SectionDefinition = {
  type: "product-reviews",
  version: 1,
  category: "products",
  templates: ["product"],
  maxPerPage: 1,
  resourceType: "product",
  fields: [],
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "product") return null;
    // The pinned product bar (product-section-tabs.tsx) is ~61px of fixed
    // chrome under the header, and the buy box's rating link deep-links
    // straight here — without an offset the jump parked the "Reviews"
    // heading and the whole summary bar behind it.
    return (
      <section
        id="reviews"
        className="container mx-auto mt-12 scroll-mt-[calc(var(--storefront-header-height,4rem)+5rem)] px-4"
      >
        {/* The thread's chunk loads on a soft navigation: its skeleton,
            drawn here so its code is not in every page's first load. */}
        <Suspense fallback={<ReviewsSkeleton />}>
          <ReviewsList productId={resource.product._id} locale={ctx.locale} />
        </Suspense>
      </section>
    );
  },
  // The placeholder ReviewsList itself shows while its chunk loads, in the
  // section's frame — what the product page's loading frame draws for the
  // thread when it is not hidden.
  Skeleton: () => (
    <section className="container mx-auto mt-12 px-4" aria-hidden>
      <ReviewsSkeleton />
    </section>
  ),
};
