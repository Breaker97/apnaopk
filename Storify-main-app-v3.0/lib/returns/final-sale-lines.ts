// No `server-only` guard: the Order model's save hook imports this, and that
// hook also runs in scripts (the seed, migrations), where the guard throws and
// the order's lines were never marked final sale.
import { Product } from "@/models/product.model";
import {
  finalSaleCollectionIdsOf,
  isFinalSaleProduct,
  type FinalSaleProductLike,
} from "@/lib/returns/final-sale";
import {
  productReturnWindowDays,
  returnWindowOverridesOf,
  type ReturnWindowProductLike,
} from "@/lib/returns/return-window";
import { ruleCollectionsOf } from "@/lib/catalog/collections";

/**
 * The automated collections named in the store's return settings — final
 * sale, return windows — that each product joins by their rules; see
 * `ruleCollectionsOf`.
 */
export async function returnRuleCollections(
  productIds: ReadonlyArray<unknown>,
  settings: Parameters<typeof finalSaleCollectionIdsOf>[0] &
    Parameters<typeof returnWindowOverridesOf>[0],
): Promise<Map<string, string[]>> {
  return ruleCollectionsOf(productIds, [
    ...finalSaleCollectionIdsOf(settings),
    ...returnWindowOverridesOf(settings).map((entry) => entry.collectionId),
  ]);
}

/**
 * The return terms each line is sold with, read off the products as they
 * stand: whether it is final sale, and its own return window when its product
 * or one of its collections set one (R6, lib/returns/return-window.ts). For
 * the moment an order is placed, which is when both are copied onto its lines
 * (see lib/returns/final-sale.ts).
 *
 * One query for all the lines. A product that no longer exists answers "not
 * final sale": an order can only be refused a return for a mark it was sold
 * under, and nothing is left to say that it was.
 */
export async function returnLineTerms(
  items: ReadonlyArray<{ productId?: unknown; variantId?: unknown } | null | undefined>,
  settings: Parameters<typeof finalSaleCollectionIdsOf>[0] &
    Parameters<typeof returnWindowOverridesOf>[0],
): Promise<Array<{ finalSale: boolean; returnWindowDays?: number }>> {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => String(item?.productId ?? ""))
        .filter((id) => /^[a-f\d]{24}$/i.test(id)),
    ),
  );
  if (productIds.length === 0) return items.map(() => ({ finalSale: false }));

  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      "_id returns.finalSale returns.windowDays collectionIds variants._id variants.finalSale",
    )
    .lean<Array<FinalSaleProductLike & ReturnWindowProductLike & { _id: unknown }>>();
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const collections = finalSaleCollectionIdsOf(settings);
  const windows = returnWindowOverridesOf(settings);
  const byRule = await returnRuleCollections(productIds, settings);

  return items.map((item) => {
    const product = byId.get(String(item?.productId ?? ""));
    const ruled = byRule.get(String(item?.productId ?? "")) ?? [];
    const windowDays = productReturnWindowDays(product, windows, ruled);
    return {
      finalSale: isFinalSaleProduct(product, item?.variantId, collections, ruled),
      ...(windowDays === undefined ? {} : { returnWindowDays: windowDays }),
    };
  });
}
