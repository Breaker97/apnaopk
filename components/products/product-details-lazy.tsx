"use client";

import dynamic from "next/dynamic";

/**
 * The product page's client controls behind a client-side lazy boundary.
 *
 * The section registry is imported by every storefront route, and a client
 * component referenced from a server component is part of that route's
 * initial scripts whether or not the page renders it — so the product page's
 * buy box, the storefront's largest client code, rode along on the home page,
 * the cart and every content page. A `dynamic()` import inside a client
 * module is a real code split: the chunk is fetched only when one of these
 * renders, i.e. on a product page, and preloaded with that page's HTML.
 *
 * The page itself is drawn on the server (product-details.tsx); these are the
 * parts of it that answer to the shopper, all from one module and so one
 * chunk. Neither has a boundary of its own: product-details.tsx wraps the
 * provider — and so every control inside it — in one Suspense whose fallback
 * is the section's skeleton, so while the chunk is on its way (a soft
 * navigation) the section shows the skeleton and then swaps in whole, never a
 * page with holes where the controls go. The fallback is drawn on the server:
 * a `loading` here would put the skeleton's code in every storefront page's
 * first load, since this module is.
 *
 * Adding or moving a `dynamic()` boundary anywhere? Run `pnpm build && pnpm
 * check:chunks` (scripts/check-dynamic-chunks.mjs). Next.js 16.3's Turbopack
 * can give a page a preload link to a chunk it never writes — a 404 on every
 * visit that nothing else reports (vercel/next.js#99149).
 */
export const ProductPurchaseProvider = dynamic(() =>
  import("./product-details-islands").then(
    (module) => module.ProductPurchaseProvider,
  ),
);

/** Every other control, by name — see product-details-islands.tsx. */
export const ProductIsland = dynamic(() =>
  import("./product-details-islands").then((module) => module.ProductIsland),
);
