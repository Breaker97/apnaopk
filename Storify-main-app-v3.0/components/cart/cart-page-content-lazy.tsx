"use client";

import dynamic from "next/dynamic";

/** Lazy boundary for the bag — see product-details-lazy.tsx. */
const CartPageContent = dynamic(() =>
  import("@/components/cart/cart-page-content").then(
    (module) => module.CartPageContent,
  ),
);

export function CartPageContentLazy() {
  return <CartPageContent />;
}
