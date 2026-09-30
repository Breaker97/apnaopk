"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the review thread — see product-details-lazy.tsx. The
 * product-reviews section wraps it in the Suspense that shows its skeleton.
 */
const ReviewsList = dynamic(() =>
  import("@/components/reviews/reviews-list").then(
    (module) => module.ReviewsList,
  ),
);

export function ReviewsListLazy(props: ComponentProps<typeof ReviewsList>) {
  return <ReviewsList {...props} />;
}
