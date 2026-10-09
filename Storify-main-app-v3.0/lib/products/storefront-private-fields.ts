/**
 * Product fields the storefront never sends.
 *
 * The product page and the public product API send the whole product document
 * less these, so they are cut in the query itself — every storefront query
 * that returns whole documents uses one of the two forms below.
 *
 * - `search`: the derived index block, a few KB of index data per product.
 * - `cost`, on the product and on every variant: what the store paid, which
 *   with the price on the same page is its margin. It rode along in the
 *   product page's RSC payload and in `GET /api/products/[slug]`.
 * - `preorder.supplierEta`, on the product and on every variant: the store's
 *   own planning date. Shoppers are shown the release date instead.
 */
const STOREFRONT_PRIVATE_PRODUCT_FIELDS = [
  "search",
  "cost",
  "variants.cost",
  "preorder.supplierEta",
  "variants.preorder.supplierEta",
] as const;

/** For `.select()` on a storefront product query. */
export const STOREFRONT_PRODUCT_SELECT = STOREFRONT_PRIVATE_PRODUCT_FIELDS.map(
  (field) => `-${field}`,
).join(" ");

/** For an aggregation `$project` that returns storefront products. */
export const STOREFRONT_PRODUCT_EXCLUSION: Record<string, 0> = Object.fromEntries(
  STOREFRONT_PRIVATE_PRODUCT_FIELDS.map((field) => [field, 0]),
);
