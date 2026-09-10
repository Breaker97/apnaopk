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
    // The pinned product bar (ProductDetails) is ~61px of fixed chrome under
    // the header, and the buy box's rating link deep-links straight here —
    // without an offset the jump parked the "Reviews" heading and the whole
    // summary bar behind it.
    return (
      <section
        id="reviews"
        className="container mx-auto mt-12 scroll-mt-[calc(var(--storefront-header-height,4rem)+5rem)] px-4"
      >
        <ReviewsList productId={resource.product._id} locale={ctx.locale} />
      </section>
    );
  },
};
