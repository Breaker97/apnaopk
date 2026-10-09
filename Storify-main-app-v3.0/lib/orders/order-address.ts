import "server-only";

import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { auditOrderAddressChanged } from "@/lib/orders/audit-order";
import {
  buildNextShippingAddress,
  type PreorderAddressInput,
  type StoredAddress,
} from "@/lib/orders/preorder-address";
import { addressSummary, isAddressHoldOpen, type AddressHold } from "@/lib/orders/address-hold-policy";
import { releaseAddressHold } from "@/lib/orders/address-hold";
import {
  addressKey,
  verifyDeliveryAddress,
  type AddressVerification,
} from "@/lib/shipping/address-verification";

/**
 * Correcting where an order ships, after checkout.
 *
 * Who may: the customer (signed in, or holding the address link) while the
 * order is on an address hold, and staff on any order that has not shipped.
 * What may change is the pre-order rule — the delivery point, never the country
 * or region (`buildNextShippingAddress`).
 *
 * The new address is checked BEFORE it is written. One a courier still can't
 * find is not saved; the caller gets the reasons and, when the carrier offered
 * one, a suggestion to pick instead. Staff can save anyway — they may know the
 * building is new — and the hold then stays for them to release. An address
 * that passes releases the hold, and the auto-ship queue picks the order up.
 */

const DISPATCHED = [ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED];

type AddressOrder = {
  _id: unknown;
  orderNumber: string;
  status?: string;
  digitalOnly?: boolean;
  fulfillment?: { method?: string } | null;
  shippingAddress?: StoredAddress;
  addressHold?: AddressHold;
  subOrders?: Array<{ status?: string; fulfillment?: { method?: string } | null }> | null;
};

type OrderAddressChangeBy = "customer" | "address-link" | "store";

/** Why this order's address can't change now, or null when it can. */
export function orderAddressChangeBlocker(
  order: AddressOrder,
  by: OrderAddressChangeBy,
): string | null {
  if (order.status === ORDER_STATUS.CANCELLED) return "This order has been cancelled";
  if (order.digitalOnly) return "This order has nothing to ship";
  const live = (order.subOrders || []).filter((sub) => sub?.status !== ORDER_STATUS.CANCELLED);
  if (
    order.fulfillment?.method === "pickup" ||
    live.some((sub) => sub?.fulfillment?.method === "pickup")
  ) {
    return "This order is collected in store, so it has no delivery address";
  }
  if (DISPATCHED.includes(order.status as (typeof DISPATCHED)[number])) {
    return "This order has already shipped, so its address can no longer change";
  }
  if (live.length > 0 && live.every((sub) => DISPATCHED.includes(sub?.status as (typeof DISPATCHED)[number]))) {
    return "This order has already shipped, so its address can no longer change";
  }
  if (by !== "store" && !isAddressHoldOpen(order)) {
    return "This order's delivery address doesn't need correcting";
  }
  return null;
}

type OrderAddressChangeResult =
  | { saved: true; order: AddressOrder; released: boolean; verification: AddressVerification }
  | { saved: false; verification: AddressVerification };

export async function changeOrderShippingAddress(params: {
  /** Scoped by the caller to whoever proved they may do this. */
  orderFilter: Record<string, unknown>;
  address: PreorderAddressInput;
  by: OrderAddressChangeBy;
  auditContext: AuditContext;
  actorId?: string;
  /** Staff only: save an address the check could not confirm. */
  force?: boolean;
}): Promise<OrderAddressChangeResult | null> {
  const order = await Order.findOne(params.orderFilter)
    .select("orderNumber status digitalOnly fulfillment shippingAddress addressHold subOrders.status subOrders.fulfillment customerId")
    .lean<AddressOrder | null>();
  if (!order) return null;

  const blocker = orderAddressChangeBlocker(order, params.by);
  if (blocker) throw new ValidationError(blocker);

  const current = order.shippingAddress || ({} as StoredAddress);
  const next = buildNextShippingAddress(current, params.address, "order");

  const verification = await verifyDeliveryAddress(next);
  const force = params.by === "store" && params.force === true;
  if (verification.verdict === "invalid" && !force) {
    return { saved: false, verification };
  }

  const updated = await Order.findOneAndUpdate(
    {
      ...params.orderFilter,
      status: { $nin: DISPATCHED },
      ...(params.by === "store" ? {} : { "addressHold.state": "open" }),
    },
    {
      $set: {
        shippingAddress: next,
        addressCheck: {
          key: addressKey(next),
          checkedAt: new Date(),
          verdict: verification.verdict,
        },
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean<AddressOrder | null>();
  if (!updated) {
    throw new ValidationError(
      "This order changed while you were editing it, and its address can no longer be updated",
    );
  }

  await auditOrderAddressChanged(params.auditContext, updated, {
    before: current as Record<string, unknown>,
    after: next as Record<string, unknown>,
    by: params.by,
  });

  const { notifyAddressHoldCustomer } = await import("@/lib/notifications/notifications");
  await notifyAddressHoldCustomer({
    orderId: String(updated._id),
    kind: "changed",
    addressSummary: addressSummary(next),
  }).catch((error) => console.error("Failed to announce an address change:", error));

  let released = false;
  if (isAddressHoldOpen(order) && verification.verdict !== "invalid") {
    ({ released } = await releaseAddressHold({
      orderId: updated._id,
      reason: params.by === "store" ? "store_edited" : "address_changed",
      actor: { id: params.actorId, context: params.auditContext },
    }));
  }

  return { saved: true, order: updated, released, verification };
}
