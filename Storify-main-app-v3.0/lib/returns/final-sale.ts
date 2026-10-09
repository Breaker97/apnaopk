/**
 * Final sale: goods the shopper cannot send back.
 *
 * A merchant marks a product final sale, overrides it variant by variant, or
 * lists whole collections in Settings → Orders → Returns. The mark is copied
 * onto each order line when the order is placed (`items[].finalSale`) and read
 * from there afterwards, as Shopify does: marking a product final sale later
 * does not take back the returns its earlier buyers were sold with.
 *
 * Pure and client-safe, so the product page, the cart and the server all
 * answer the question the same way.
 */

type IdLike = unknown;

/** How many collections the store may list as final sale. */
export const MAX_FINAL_SALE_COLLECTIONS = 200;

const idString = (value: IdLike): string => {
  if (value && typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    return String((value as { _id?: unknown })._id ?? "");
  }
  return String(value ?? "");
};

/** The collections the store sells as final sale, as id strings. */
export function finalSaleCollectionIdsOf(
  settings:
    | {
        orders?: {
          returns?: { finalSaleCollectionIds?: ReadonlyArray<IdLike> | null } | null;
        } | null;
      }
    | null
    | undefined,
): string[] {
  return (settings?.orders?.returns?.finalSaleCollectionIds || [])
    .map(idString)
    .filter(Boolean);
}

/**
 * Whether one line is final sale.
 *
 * The variant's own setting wins when it has one — "returnable" on a variant
 * frees it even from a final sale collection, the most specific choice being
 * the merchant's last word. Without one, the product's mark or any of its
 * collections makes it final sale.
 */
export function isFinalSale(params: {
  productFinalSale?: boolean | null;
  variantFinalSale?: boolean | null;
  productCollectionIds?: ReadonlyArray<IdLike> | null;
  finalSaleCollectionIds?: ReadonlyArray<IdLike> | null;
}): boolean {
  if (typeof params.variantFinalSale === "boolean") return params.variantFinalSale;
  if (params.productFinalSale === true) return true;
  const listed = new Set((params.finalSaleCollectionIds || []).map(idString));
  if (listed.size === 0) return false;
  return (params.productCollectionIds || []).some((id) => listed.has(idString(id)));
}

/** The product fields `isFinalSaleProduct` reads — loose, so a lean doc fits. */
export type FinalSaleProductLike = {
  returns?: { finalSale?: boolean | null } | null;
  collectionIds?: ReadonlyArray<IdLike> | null;
  variants?: ReadonlyArray<{ _id?: IdLike; finalSale?: boolean | null }> | null;
};

/**
 * Whether a product — or the chosen variant of it — is final sale.
 * `ruleCollectionIds` are the automated collections it joins by their rules,
 * which its own `collectionIds` never list (`ruleCollectionsOf`).
 */
export function isFinalSaleProduct(
  product: FinalSaleProductLike | null | undefined,
  variantId: IdLike,
  finalSaleCollectionIds: ReadonlyArray<IdLike>,
  ruleCollectionIds: ReadonlyArray<IdLike> = [],
): boolean {
  if (!product) return false;
  const wanted = idString(variantId);
  const variant = wanted
    ? (product.variants || []).find((candidate) => idString(candidate?._id) === wanted)
    : undefined;
  return isFinalSale({
    productFinalSale: product.returns?.finalSale,
    variantFinalSale: variant?.finalSale,
    productCollectionIds: [...(product.collectionIds || []), ...ruleCollectionIds],
    finalSaleCollectionIds,
  });
}

/** The lines of an order sold as final sale. */
export function finalSaleItemIndexes(
  items: ReadonlyArray<{ finalSale?: boolean | null } | null | undefined> | null | undefined,
): number[] {
  return (items || []).flatMap((item, index) => (item?.finalSale === true ? [index] : []));
}
