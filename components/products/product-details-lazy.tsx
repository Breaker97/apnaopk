"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { ProductDetailsSkeleton } from "@/components/products/product-details-skeleton";

/**
 * The buy box behind a client-side lazy boundary.
 *
 * The section registry is imported by every storefront route, and a client
 * component referenced from a server component is part of that route's
 * initial scripts whether or not the page renders it — so ProductDetails,
 * the storefront's largest client component, rode along on the home page,
 * the cart and every content page. A `dynamic()` import inside a client
 * module is a real code split: the chunk is fetched only when this wrapper
 * renders, i.e. on a product page.
 */
const ProductDetails = dynamic(
  () =>
    import("@/components/products/product-details").then(
      (module) => module.ProductDetails,
    ),
  { loading: () => <ProductDetailsSkeleton /> },
);

export type ProductDetailsProps = ComponentProps<typeof ProductDetails>;

export function ProductDetailsLazy(props: ProductDetailsProps) {
  return <ProductDetails {...props} />;
}
