import {
  decrementInventory,
  InsufficientStockError,
  type InventoryAdjustmentOptions,
} from "@/lib/inventory/inventory";
import {
  markOrderInventoryReserved,
  restoreOrderInventory,
} from "@/lib/orders/order-inventory";

/**
 * Take the stock for an order paid by a mobile-money push, at the moment the
 * order is written rather than when the money lands.
 *
 * These gateways are asked for the money asynchronously: the request is
 * accepted, a PIN prompt goes to the payer's phone, and the answer comes back
 * minutes later. Shopify treats that as an order with a pending payment — and
 * an order holds its goods. Storify used to hold nothing until capture, which
 * left the one failure these providers cannot recover from: two shoppers
 * approve a PIN for the last item, both payments succeed, and the second order
 * is cancelled and refunded after the money has moved — by hand, because
 * **ioTec, MTN and Orange have no refund API** (`finalize-order.ts:514`).
 *
 * So the goods come off the shelf when the order is written, and go back when
 * it expires or is refused. The capture path then skips its own decrement,
 * because every live consignment is already flagged (`settleCapturedOrder`).
 *
 * **Pre-orders are left alone.** A reservation line holds quota, not stock,
 * and its quota is taken by the path that already owns it. Such an order falls
 * through here untouched and is handled at capture exactly as before.
 */

type ReservableLine = {
  productId: { _id?: unknown } | unknown;
  variantId?: unknown;
  quantity: number;
  purchaseType?: string;
};

type ReservableOrder = {
  _id: unknown;
  hasPreorder?: boolean;
};

function lineProductId(line: ReservableLine): string {
  const product = line.productId as { _id?: unknown } | null;
  return String(product && typeof product === "object" && "_id" in product
    ? product._id
    : line.productId);
}

/**
 * Returns the name of the product that ran out, or null when the goods were
 * taken. The caller turns a name into the shopper's error: this module has no
 * business deciding how a checkout refuses.
 */
export async function reserveAsyncPushInventory(params: {
  order: ReservableOrder;
  items: ReservableLine[];
  /** Pickup counter the shopper chose, when the order is collected. */
  inventoryOpts?: InventoryAdjustmentOptions;
}): Promise<{ soldOutProductId: string } | null> {
  // A pre-order's quota is somebody else's job — see above.
  if (params.order.hasPreorder) return null;

  const lines = params.items
    .filter((item) => (item.purchaseType || "standard") === "standard")
    .map((item) => ({
      productId: lineProductId(item),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: Number(item.quantity || 0),
    }))
    .filter((line) => line.quantity > 0);

  if (lines.length === 0) return null;

  try {
    await decrementInventory(lines, params.inventoryOpts || {});
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return { soldOutProductId: String(error.line?.productId ?? "") };
    }
    throw error;
  }

  // Flags the consignments, which is what tells the capture path the goods are
  // already held and what lets a later cancel or expiry give them back.
  await markOrderInventoryReserved(String(params.order._id)).catch((err) =>
    console.error(
      "Failed to flag inventory reserved on a mobile-money order:",
      err,
    ),
  );
  return null;
}

/**
 * Give back goods held by an order whose payment never happened — a provider
 * that refused the request outright, or a push nobody answered.
 *
 * Claim-based inside `restoreOrderInventory`, so calling it twice puts nothing
 * back twice, and an order that never held anything is a no-op.
 */
export async function releaseAsyncPushInventory(
  orderId: unknown,
): Promise<void> {
  try {
    await restoreOrderInventory(String(orderId));
  } catch (error) {
    console.error(
      `Failed to give back the stock held by order ${String(orderId)}:`,
      error,
    );
  }
}
