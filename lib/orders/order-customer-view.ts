import "server-only";

import { Vendor } from "@/models";
import { resolveSubOrderPaymentStatus } from "@/lib/orders/order-payment-status";

/**
 * An order as the person who placed it may see it.
 *
 * Two problems, one shape. The customer order API returned the raw document,
 * so every sub-order handed the browser that vendor's commission rate, their
 * earnings on the sale and their payout schedule — the marketplace's private
 * economics, published to whoever bought a T-shirt. And the screens that
 * consumed it read only `order.status`, so a shopper whose two vendors were in
 * completely different places was shown one badge that could only be right
 * about one of them.
 *
 * So the sanitizer and the per-shipment view arrive together: this returns the
 * consignments, with only the fields a customer has any business seeing, and
 * with the index mapping the returns flow needs to stay index-based.
 */

interface CustomerSubOrderView {
  _id?: string;
  vendorId?: string;
  /** Falls back to undefined for a deleted vendor; the UI labels it generically. */
  vendorName?: string;
  status: string;
  /** Resolved through the order-level fallback, never read raw. */
  paymentStatus: string;
  subtotal: number;
  shippingCost: number;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;
  fulfillment?: unknown;
  /**
   * Positions in `order.items` that belong to this consignment.
   *
   * Indexes rather than a second copy of the items: return requests are
   * recorded against `orderItemIndex`, so a view that renumbered items per
   * shipment would quietly file returns against the wrong line.
   */
  itemIndexes: number[];
}

type RawSubOrder = {
  _id?: unknown;
  vendorId?: unknown;
  status?: string;
  paymentStatus?: string | null;
  subtotal?: number;
  shippingCost?: number;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  fulfillment?: unknown;
};

type RawOrder = {
  paymentStatus?: string;
  items?: Array<{ vendorId?: unknown }>;
  subOrders?: RawSubOrder[] | null;
  [key: string]: unknown;
};

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Replace an order's sub-orders with the customer-safe view of them.
 *
 * Single-vendor orders keep an empty `subOrders`: there is no second party to
 * distinguish, the order-level status already says everything, and shipping a
 * one-row "shipments" section would be noise on the overwhelming majority of
 * stores.
 */
export async function sanitizeOrderForCustomer<T extends RawOrder>(
  order: T,
): Promise<Omit<T, "subOrders"> & { subOrders: CustomerSubOrderView[] }> {
  const [sanitized] = await sanitizeOrdersForCustomer([order]);
  return sanitized;
}

/**
 * The list-page equivalent, resolving every order's seller names in ONE query.
 *
 * A page of ten split orders would otherwise issue ten vendor lookups, and the
 * customer order list is one of the most-hit authenticated pages there is.
 */
export async function sanitizeOrdersForCustomer<T extends RawOrder>(
  orders: T[],
): Promise<Array<Omit<T, "subOrders"> & { subOrders: CustomerSubOrderView[] }>> {
  const vendorIds = new Set<string>();
  for (const order of orders) {
    const raw = order.subOrders || [];
    if (raw.length < 2) continue;
    for (const subOrder of raw) {
      if (subOrder.vendorId) vendorIds.add(String(subOrder.vendorId));
    }
  }

  const vendors = vendorIds.size
    ? await Vendor.find({ _id: { $in: [...vendorIds] } })
        .select("storeName")
        .lean<Array<{ _id: unknown; storeName?: string }>>()
    : [];
  const namesById = new Map(
    vendors.map((vendor) => [String(vendor._id), vendor.storeName]),
  );

  return orders.map((order) => sanitizeOne(order, namesById));
}

function sanitizeOne<T extends RawOrder>(
  order: T,
  namesById: Map<string, string | undefined>,
): Omit<T, "subOrders"> & { subOrders: CustomerSubOrderView[] } {
  const raw = order.subOrders || [];

  if (raw.length < 2) {
    return { ...order, subOrders: [] };
  }

  const items = order.items || [];

  const subOrders: CustomerSubOrderView[] = raw.map((subOrder) => {
    const vendorId = subOrder.vendorId ? String(subOrder.vendorId) : undefined;
    return {
      _id: subOrder._id ? String(subOrder._id) : undefined,
      vendorId,
      vendorName: vendorId ? namesById.get(vendorId) : undefined,
      status: String(subOrder.status || ""),
      paymentStatus: resolveSubOrderPaymentStatus(order, subOrder),
      subtotal: Number(subOrder.subtotal || 0),
      shippingCost: Number(subOrder.shippingCost || 0),
      trackingNumber: subOrder.trackingNumber || undefined,
      carrier: subOrder.carrier || undefined,
      shippedAt: iso(subOrder.shippedAt),
      deliveredAt: iso(subOrder.deliveredAt),
      fulfillment: subOrder.fulfillment,
      itemIndexes: items.reduce<number[]>((acc, item, index) => {
        if (vendorId && item?.vendorId && String(item.vendorId) === vendorId) {
          acc.push(index);
        }
        return acc;
      }, []),
    };
  });

  return { ...order, subOrders };
}
