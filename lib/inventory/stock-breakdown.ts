import { CheckoutAttempt, Order, Product, ReturnRequest } from "@/models";
import { productTracksStock } from "@/lib/products/stock-policy";
import { ORDER_STATUS } from "@/config/app.config";
import { PURCHASE_TYPE } from "@/lib/orders/preorders";
import { RETURN_STATUS, UNSELLABLE_RETURN_CONDITIONS } from "@/lib/returns/returns";
import { heldReturnUnits, type HeldReturnSource } from "@/lib/returns/held-units";

/**
 * Where a row's units are, the way a shelf count would find them.
 *
 * `stock` is what can still be sold: an order takes its units off it the moment
 * it is placed (a card checkout, the moment the shopper leaves for the gateway),
 * and a return's damaged units never go back on it. Those units are still on
 * the premises, though, so reading `stock` as "on hand" came up short against
 * any count of the shelf. The inventory list therefore shows the three parts:
 *
 * - **Available** — `stock`, what the storefront can still sell.
 * - **Committed** — sold, still here: the lines of every consignment that took
 *   its stock and has not shipped, been collected or been called off, and what
 *   a checkout is holding while its shopper is at the gateway.
 * - **Unavailable** — here, not for sale: units a return's count found damaged,
 *   missing parts or unusable, until the merchant restocks or writes them off.
 *
 * and **On hand** as their sum. Store-wide, like Available: a location filter
 * narrows which rows are listed, not the figures on them.
 *
 * Read for the returned page only — three bounded reads, never a scan of every
 * order ever placed: open orders by the indexed order status, the short-lived
 * checkout holds, and counted returns naming the page's products.
 */

/** An order holds unshipped stock only while one of its consignments is live. */
const OPEN_ORDER_STATUSES: string[] = [
  ORDER_STATUS.PREORDERED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
];

/** A consignment in one of these no longer has its units on the premises. */
const OFF_PREMISES_STATUSES: string[] = [
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.CANCELLED,
];

type RowKey = string;

function rowKey(productId: unknown, variantId: unknown): RowKey {
  return `${String(productId ?? "")}:${variantId ? String(variantId) : ""}`;
}

type CommittedOrder = {
  subOrders?: Array<{
    status?: string | null;
    inventoryReserved?: boolean | null;
    preorderReserved?: boolean | null;
    items?: Array<{
      productId?: unknown;
      variantId?: unknown;
      quantity?: number | null;
      purchaseType?: string | null;
    } | null> | null;
  } | null> | null;
};

/**
 * Units sold and still on the premises, per row, from open orders.
 *
 * A consignment counts while it holds a stock reservation and has not left: an
 * unpaid gateway order never took its stock, and a restored one gave it back.
 * A pre-order line holds quota, not stock, until the pre-order is released —
 * the release takes the stock and clears `preorderReserved`.
 */
export function committedUnitsFromOrders(
  orders: ReadonlyArray<CommittedOrder | null>,
  wanted: ReadonlySet<RowKey> | null,
): Map<RowKey, number> {
  const units = new Map<RowKey, number>();
  for (const order of orders) {
    for (const sub of order?.subOrders || []) {
      if (!sub?.inventoryReserved) continue;
      if (OFF_PREMISES_STATUSES.includes(String(sub.status || ""))) continue;
      for (const item of sub.items || []) {
        if (!item?.productId) continue;
        if (
          item.purchaseType === PURCHASE_TYPE.PREORDER &&
          sub.preorderReserved === true
        ) {
          continue;
        }
        const key = rowKey(
          (item.productId as { _id?: unknown })?._id ?? item.productId,
          item.variantId,
        );
        if (wanted && !wanted.has(key)) continue;
        const quantity = Math.max(0, Math.trunc(Number(item.quantity || 0)));
        units.set(key, (units.get(key) || 0) + quantity);
      }
    }
  }
  return units;
}

type HoldingAttempt = {
  stockHold?: {
    releasedAt?: Date | null;
    lines?: Array<{
      productId?: unknown;
      variantId?: unknown;
      quantity?: number | null;
    } | null> | null;
  } | null;
};

/**
 * Units a checkout is holding while its shopper is at the gateway. Released
 * (the hold ran out, or an order took the goods over) holds nothing: the order
 * then counts them itself.
 */
export function committedUnitsFromHolds(
  attempts: ReadonlyArray<HoldingAttempt | null>,
  wanted: ReadonlySet<RowKey> | null,
): Map<RowKey, number> {
  const units = new Map<RowKey, number>();
  for (const attempt of attempts) {
    const hold = attempt?.stockHold;
    if (!hold || hold.releasedAt) continue;
    for (const line of hold.lines || []) {
      if (!line?.productId) continue;
      const key = rowKey(line.productId, line.variantId);
      if (wanted && !wanted.has(key)) continue;
      const quantity = Math.max(0, Math.trunc(Number(line.quantity || 0)));
      units.set(key, (units.get(key) || 0) + quantity);
    }
  }
  return units;
}

/** Units the page's products hold as unsellable, per row. */
export function unavailableUnitsFromReturns(
  returns: ReadonlyArray<HeldReturnSource | null>,
  wanted: ReadonlySet<RowKey> | null,
): Map<RowKey, number> {
  const units = new Map<RowKey, number>();
  for (const request of returns) {
    if (!request) continue;
    for (const line of heldReturnUnits(request)) {
      const key = rowKey(line.productId, line.variantId);
      if ((wanted && !wanted.has(key)) || line.held === 0) continue;
      units.set(key, (units.get(key) || 0) + line.held);
    }
  }
  return units;
}

type BreakdownInput = {
  productId: string;
  variantId: string | null;
  /** The sellable counter as stored — negative on a product that oversells. */
  stock: number;
  /** False for a digital or untracked product, whose orders take no stock. */
  tracksStock: boolean;
};

type StockBreakdown = {
  available: number;
  committed: number;
  unavailable: number;
  onHand: number;
};

/**
 * The figures for one row. On hand adds back what is sold but still here, so a
 * product that oversold (`stock` below zero) reads the units physically left.
 */
export function stockBreakdown(
  stock: number,
  committed: number,
  unavailable: number,
): StockBreakdown {
  const sellable = Number.isFinite(stock) ? stock : 0;
  return {
    available: Math.max(0, sellable),
    committed,
    unavailable,
    onHand: Math.max(0, sellable + committed + unavailable),
  };
}

const ORDER_SELECT =
  "subOrders.status subOrders.inventoryReserved subOrders.preorderReserved subOrders.items.productId subOrders.items.variantId subOrders.items.quantity subOrders.items.purchaseType";
const RETURN_SELECT =
  "status itemsCountedAt items.productId items.variantId items.quantityReceived items.condition unsellableDispositions";

/**
 * The three bounded reads behind Committed and Unavailable — open orders by the
 * indexed status, the short-lived checkout holds, counted returns holding
 * unsellable units — narrowed to `productIds` when given. A read that fails
 * reads as nothing: a missing figure must not take the page down with it.
 */
async function readOffShelfSources(productIds?: string[]) {
  const quietly = <R,>(read: Promise<R[]>, what: string): Promise<R[]> =>
    read.catch((error) => {
      console.error(`Failed to read ${what} for the inventory figures:`, error);
      return [];
    });
  const [orders, attempts, returns] = await Promise.all([
    quietly(
      Order.find({
        status: { $in: OPEN_ORDER_STATUSES },
        ...(productIds ? { "subOrders.items.productId": { $in: productIds } } : {}),
      })
        .select(ORDER_SELECT)
        .lean<CommittedOrder[]>(),
      "committed orders",
    ),
    quietly(
      CheckoutAttempt.find({
        "stockHold.releasedAt": null,
        ...(productIds
          ? { "stockHold.lines.productId": { $in: productIds } }
          : { "stockHold.lines.0": { $exists: true } }),
      })
        .select("stockHold.releasedAt stockHold.lines")
        .lean<HoldingAttempt[]>(),
      "checkout holds",
    ),
    quietly(
      ReturnRequest.find({
        itemsCountedAt: { $exists: true },
        status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
        items: {
          $elemMatch: {
            ...(productIds ? { productId: { $in: productIds } } : {}),
            condition: { $in: UNSELLABLE_RETURN_CONDITIONS },
          },
        },
      })
        .select(RETURN_SELECT)
        .lean<HeldReturnSource[]>(),
      "unsellable returns",
    ),
  ]);
  return { orders, attempts, returns };
}

/**
 * Committed and unavailable units summed over every product `productScope`
 * admits — what the inventory pages' "On hand units" adds to the stock so it
 * reads the same as the table's On hand. `productScope` is a Product filter:
 * empty for the whole store, `{ vendorId }` for a vendor, a staff member's scope
 * filter for staff. Only the products that appear in open orders, holds and
 * returns are looked up, never the whole catalogue.
 */
export async function offShelfStockTotals(
  productScope: Record<string, unknown> = {},
): Promise<{ committed: number; unavailable: number }> {
  const { orders, attempts, returns } = await readOffShelfSources();
  const committed = committedUnitsFromOrders(orders, null);
  for (const [key, units] of committedUnitsFromHolds(attempts, null)) {
    committed.set(key, (committed.get(key) || 0) + units);
  }
  const unavailable = unavailableUnitsFromReturns(returns, null);

  const productOf = (key: RowKey) => key.split(":")[0];
  const productIds = [
    ...new Set([...committed.keys(), ...unavailable.keys()].map(productOf)),
  ];
  if (productIds.length === 0) return { committed: 0, unavailable: 0 };

  const products = await Product.find(
    Object.keys(productScope).length > 0
      ? { $and: [{ _id: { $in: productIds } }, productScope] }
      : { _id: { $in: productIds } },
  )
    .select("shipping.isPhysicalProduct inventory.tracked")
    .lean<Array<{ _id: unknown } & Parameters<typeof productTracksStock>[0]>>()
    .catch((error) => {
      console.error("Failed to read products for the inventory figures:", error);
      return [];
    });
  const tracks = new Map(
    products.map((product) => [String(product._id), productTracksStock(product)]),
  );

  const sum = (units: Map<RowKey, number>, onlyTracked: boolean) =>
    [...units].reduce((total, [key, count]) => {
      const tracked = tracks.get(productOf(key));
      if (tracked === undefined || (onlyTracked && !tracked)) return total;
      return total + count;
    }, 0);
  return { committed: sum(committed, true), unavailable: sum(unavailable, false) };
}

export async function attachStockBreakdown<T extends BreakdownInput>(
  rows: T[],
): Promise<Array<Omit<T, "stock" | "tracksStock"> & StockBreakdown>> {
  if (rows.length === 0) return [];

  const wanted = new Set(rows.map((row) => rowKey(row.productId, row.variantId)));
  const productIds = [...new Set(rows.map((row) => row.productId))];

  const { orders, attempts, returns } = await readOffShelfSources(productIds);
  const fromOrders = committedUnitsFromOrders(orders, wanted);
  const fromHolds = committedUnitsFromHolds(attempts, wanted);
  const unavailable = unavailableUnitsFromReturns(returns, wanted);

  return rows.map(({ stock, tracksStock, ...row }) => {
    const key = rowKey(row.productId, row.variantId);
    // A digital or untracked product's orders never moved its counter, so
    // nothing of it is committed out of it.
    const committed = tracksStock
      ? (fromOrders.get(key) || 0) + (fromHolds.get(key) || 0)
      : 0;
    return {
      ...row,
      ...stockBreakdown(stock, committed, unavailable.get(key) || 0),
    };
  });
}
