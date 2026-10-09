/**
 * What a sold unit cost the seller, frozen onto the order line.
 *
 * An order is a historical record and `Product.cost` is not: a supplier price
 * rises, someone edits the field, and every margin ever reported for that
 * product silently changes with it. Reading cost back through the product at
 * report time therefore cannot produce a true figure for last month — only for
 * a hypothetical month where today's cost always applied. The only fix is to
 * copy the number at the moment of sale, exactly as `price`, `name`, `sku` and
 * the customs snapshot are already copied.
 *
 * Precedence mirrors `resolveCurrentItemPrice`: a variant's own cost wins,
 * because `Product.cost` on a variant product is the parent's figure and can be
 * wrong for the specific unit sold.
 *
 * **Absent is not zero.** A store that has never filled the cost field must
 * report "margin unknown", not "margin = 100%". So this returns `undefined`
 * rather than 0 when nothing is recorded, the schema field has no default, and
 * every reader has to handle the gap. That distinction is also what lets a
 * finance report name the period before cost tracking began instead of
 * printing a confident, false profit for it.
 */

interface ItemCostProductLike {
  cost?: number | null;
  variants?: Array<{
    _id?: unknown;
    cost?: number | null;
  }> | null;
}

interface ItemCostVariantLike {
  cost?: number | null;
}

/** A cost worth recording: a real, non-negative number. */
function usableCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

/**
 * The unit cost to snapshot onto an order line, or `undefined` when the seller
 * does not track cost for this product.
 *
 * Pass `variant` when the caller has already resolved it (the manual-order
 * paths do); pass `variantId` when only the id is known and the product
 * document carries its variants (the cart paths do).
 */
export function resolveOrderItemCost(params: {
  product?: ItemCostProductLike | null;
  variant?: ItemCostVariantLike | null;
  variantId?: unknown;
}): number | undefined {
  const { product } = params;

  const variant =
    params.variant ??
    (params.variantId && Array.isArray(product?.variants)
      ? product.variants.find(
          (candidate) =>
            String(candidate?._id ?? "") === String(params.variantId),
        )
      : undefined);

  const variantCost = usableCost(variant?.cost);
  if (variantCost !== undefined) return variantCost;

  return usableCost(product?.cost);
}
