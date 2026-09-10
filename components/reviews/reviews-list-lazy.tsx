"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { ReviewsSkeleton } from "@/components/products/product-details-skeleton";

/** Lazy boundary for the review thread — see product-details-lazy.tsx. */
const ReviewsList = dynamic(
  () =>
    import("@/components/reviews/reviews-list").then(
      (module) => module.ReviewsList,
    ),
  { loading: () => <ReviewsSkeleton /> },
);

export function ReviewsListLazy(props: ComponentProps<typeof ReviewsList>) {
  return <ReviewsList {...props} />;
}
