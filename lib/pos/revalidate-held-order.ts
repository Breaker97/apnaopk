import type {
  POSCartItem,
  POSProduct,
  POSVariant,
} from "@/components/pos/pos-types";
import { getPurchasableQuantity } from "@/lib/products/stock-policy";

/**
 * A held sale is a snapshot: `price` and `maxStock` are whatever they were when
 * the cashier parked it. Restoring that snapshot verbatim rings the sale up at
 * a stale price, or against stock that has since been sold at another register
 * or online. Resuming therefore re-reads every line against the live catalogue
 * and reports what moved, so the cashier confirms rather than discovers it on
 * the receipt.
 */

export type HeldOrderAdjustment =
  | { kind: "removed"; name: string; reason: "unavailable" | "out_of_stock" }
  | { kind: "price"; name: string; from: number; to: number }
  | { kind: "quantity"; name: string; from: number; to: number };

export interface HeldOrderRevalidation {
  cart: POSCartItem[];
  adjustments: HeldOrderAdjustment[];
  /** True when nothing in the sale survived — resuming would open an empty cart. */
  isEmpty: boolean;
}

function lineName(item: POSCartItem): string {
  return item.variantName ? `${item.name} · ${item.variantName}` : item.name;
}

export function revalidateHeldCart(
  cart: POSCartItem[],
  products: POSProduct[],
): HeldOrderRevalidation {
  const byId = new Map(products.map((product) => [product._id, product]));
  const nextCart: POSCartItem[] = [];
  const adjustments: HeldOrderAdjustment[] = [];

  for (const item of cart) {
    const product = byId.get(item.productId);
    // Absent means deleted, archived, unpublished from the register, or (for a
    // consignment line) no longer sellable at this location — the id lookup
    // applies the same visibility rules as the product grid.
    if (!product) {
      adjustments.push({
        kind: "removed",
        name: lineName(item),
        reason: "unavailable",
      });
      continue;
    }

    let variant: POSVariant | undefined;
    if (item.variantId) {
      variant = product.variants?.find((entry) => entry._id === item.variantId);
      if (!variant) {
        adjustments.push({
          kind: "removed",
          name: lineName(item),
          reason: "unavailable",
        });
        continue;
      }
    }

    const purchasable = getPurchasableQuantity(
      product,
      variant ? variant.stock : product.stock,
    );
    if (purchasable <= 0) {
      adjustments.push({
        kind: "removed",
        name: lineName(item),
        reason: "out_of_stock",
      });
      continue;
    }

    const price = variant ? variant.price : product.price;
    const quantity = Math.min(item.quantity, purchasable);

    if (price !== item.price) {
      adjustments.push({
        kind: "price",
        name: lineName(item),
        from: item.price,
        to: price,
      });
    }
    if (quantity !== item.quantity) {
      adjustments.push({
        kind: "quantity",
        name: lineName(item),
        from: item.quantity,
        to: quantity,
      });
    }

    nextCart.push({
      ...item,
      // Descriptive fields are refreshed silently: a renamed product or a new
      // image changes nothing about what is charged, but a stale one would
      // print on the receipt.
      name: product.name,
      variantName: variant?.name ?? item.variantName,
      sku: variant?.sku || product.sku,
      image: variant?.image || product.images?.[0] || item.image,
      vendorId: product.vendorId,
      price,
      quantity,
      maxStock: purchasable,
    });
  }

  return { cart: nextCart, adjustments, isEmpty: nextCart.length === 0 };
}

/** One-line summary for the resume toast. */
export function describeHeldOrderAdjustments(
  adjustments: HeldOrderAdjustment[],
): string {
  const removed = adjustments.filter((entry) => entry.kind === "removed").length;
  const repriced = adjustments.filter((entry) => entry.kind === "price").length;
  const reduced = adjustments.filter(
    (entry) => entry.kind === "quantity",
  ).length;

  const parts: string[] = [];
  if (removed) parts.push(`${removed} line${removed === 1 ? "" : "s"} removed`);
  if (repriced) parts.push(`${repriced} repriced`);
  if (reduced) parts.push(`${reduced} reduced to available stock`);

  return parts.join(" · ");
}
