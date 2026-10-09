import type { ClientSession } from "mongoose";
import { Product } from "@/models";
import { collectionScope, type ScopeSubOrder } from "@/lib/orders/preorder-scope";

/**
 * Whether an order is acting on a release date its product has since moved.
 *
 * A product's `preorderTermsRevision` goes up, in the same write, whenever a
 * save changes one of its pre-order release dates; each order line records
 * the revision it was last reconciled against. A waiting line behind its
 * product is provably waiting on a date propagation
 * (`lib/orders/preorder-terms-sync.ts`), and nothing may ask for money or
 * release goods on its old date until that has run — or the line has been
 * reconciled on the spot.
 */

export type StaleTermsLine = {
  subOrderId: string;
  productId: string;
  variantId?: string;
  lineRevision: number;
  productRevision: number;
};

type TermsItem = {
  productId?: unknown;
  variantId?: unknown;
  purchaseType?: string;
  preorderTermsRevision?: number | null;
};

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

/** The waiting pre-order lines whose product has a newer terms revision. */
export async function findStaleTermsLines(
  order: { subOrders?: Array<ScopeSubOrder & { items?: TermsItem[] | null }> | null },
  session?: ClientSession,
): Promise<StaleTermsLine[]> {
  const scope = collectionScope(order);
  const lines = scope.flatMap((sub) =>
    (sub.items || [])
      .filter((item) => item?.purchaseType === "preorder")
      .map((item) => ({ sub, item: item as TermsItem })),
  );
  if (lines.length === 0) return [];
  const productIds = Array.from(new Set(lines.map(({ item }) => id(item.productId))));
  const query = Product.find({ _id: { $in: productIds } }).select("_id preorderTermsRevision");
  if (session) query.session(session);
  const products = (await query.lean()) as Array<{ _id: unknown; preorderTermsRevision?: number }>;
  const revision = new Map(
    products.map((product) => [id(product._id), Number(product.preorderTermsRevision || 0)]),
  );
  const stale: StaleTermsLine[] = [];
  for (const { sub, item } of lines) {
    const productId = id(item.productId);
    const productRevision = revision.get(productId) ?? 0;
    const lineRevision = Number(item.preorderTermsRevision || 0);
    if (lineRevision < productRevision) {
      stale.push({
        subOrderId: id(sub._id),
        productId,
        ...(item.variantId ? { variantId: id(item.variantId) } : {}),
        lineRevision,
        productRevision,
      });
    }
  }
  return stale;
}
