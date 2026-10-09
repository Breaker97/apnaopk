import { Order } from "@/models";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";

/**
 * Returns taken on a walk-in POS sale name no customer.
 *
 * A return copies its order's `customerId`, and a counter sale with no
 * customer chosen is filed under its cashier — so the returns screens showed
 * the cashier as the shopper. A return carries neither the channel nor the
 * cashier, so its order is read: one query for a page of returns. Such a
 * return goes out with no customer and `posWalkIn` set, for the screens to
 * print their own label; every other return is left as it was.
 */
export async function markWalkInReturns<
  T extends { orderId?: unknown; customerId?: unknown },
>(requests: T[]): Promise<Array<T & { posWalkIn?: true }>> {
  const orderIds = [
    ...new Set(
      requests.map((request) => String(request.orderId ?? "")).filter(Boolean),
    ),
  ];
  if (orderIds.length === 0) return requests;

  const orders = await Order.find({ _id: { $in: orderIds }, channel: "pos" })
    .select("channel staffId customerId")
    .lean<Array<{ _id: unknown; channel?: string; staffId?: string; customerId?: unknown }>>();
  const walkIns = new Set(
    orders.filter((order) => isPosWalkIn(order)).map((order) => String(order._id)),
  );
  if (walkIns.size === 0) return requests;

  return requests.map((request) =>
    walkIns.has(String(request.orderId))
      ? { ...request, customerId: undefined, posWalkIn: true as const }
      : request,
  );
}
