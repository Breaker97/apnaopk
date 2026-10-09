import { OrderDetail, TrackOrderRequest } from "@/contracts/mobile/shop/v1/orders";
import type { OrderAddress, OrderPreOrderDetail } from "@/contracts/mobile/shop/v1/orders";
import { MobileApiError } from "@/lib/api-core/errors";
import { rateLimitExceeded } from "@/lib/api-core/rate-limit";
import { defineRoute } from "@/lib/api-core/registry";
import {
  lookUpGuestOrder,
  maskPhone,
  type TrackedOrder,
} from "@/lib/orders/guest-order-tracking";
import type { IOrder } from "@/types";
import { buildOrderDetail, orderNotFound } from "./detail";

/**
 * The order a guest asked for, through the website tracker's own lookup
 * (lib/orders/guest-order-tracking.ts): the same per-order limit and counter,
 * the same contact match, and one 404 for a wrong number or a wrong contact.
 */
export async function findTrackedOrder(
  input: TrackOrderRequest,
  ip: string | undefined,
): Promise<TrackedOrder> {
  const lookup = await lookUpGuestOrder({ orderNumber: input.orderNumber, contact: input.contact, ip });
  switch (lookup.kind) {
    case "found":
      return lookup.order;
    case "not_found":
      throw orderNotFound();
    case "rate_limited":
      throw rateLimitExceeded(lookup.retryAfter);
    case "incomplete":
      // The request's schema already refuses a blank field.
      throw new MobileApiError(400, "VALIDATION_ERROR", "Enter the order number and its email address or phone.");
  }
}

function guestAddress(address: OrderAddress | undefined): OrderAddress | undefined {
  if (!address) return undefined;
  return {
    name: address.name,
    street: address.street,
    apartment: address.apartment,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    phone: maskPhone(address.phone),
  };
}

function guestPreOrder(preOrder: OrderPreOrderDetail | undefined): OrderPreOrderDetail | undefined {
  if (!preOrder) return undefined;
  return {
    status: preOrder.status,
    releaseDate: preOrder.releaseDate,
    originalReleaseDate: preOrder.originalReleaseDate,
    delayReason: preOrder.delayReason,
  };
}

/**
 * An order as a guest who found it may see it: what the website's tracking
 * page shows, in the signed-in screen's shape so the app draws it with the
 * same screen. Built field by field, so a field added to `OrderDetail` later
 * stays out of here until somebody decides a guest may see it.
 *
 * Left out: the billing address, the shopper's note, the address-hold notice
 * (confirming the address is an action) and a pre-order's balance (paying it
 * is one). The delivery phone is masked as the website masks it. Nothing can
 * be acted on: `canCancel` is false.
 */
export function toGuestOrderDetail(detail: OrderDetail): OrderDetail {
  return {
    id: detail.id,
    number: detail.number,
    status: detail.status,
    paymentStatus: detail.paymentStatus,
    paymentMethod: detail.paymentMethod,
    placedAt: detail.placedAt,
    cancelledAt: detail.cancelledAt,
    canCancel: false,
    lines: detail.lines,
    totals: detail.totals,
    shippingAddress: guestAddress(detail.shippingAddress),
    shippingMethod: detail.shippingMethod,
    pickup: detail.pickup,
    tracking: detail.tracking,
    shipments: detail.shipments,
    preOrder: guestPreOrder(detail.preOrder),
  };
}

/** POST /orders/track */
export const orderTrackRoute = defineRoute({
  id: "orders.track",
  method: "POST",
  path: "/orders/track",
  auth: "none",
  cache: { kind: "private" },
  rateLimit: { bucket: "orders:track", preset: "strict" },
  demo: "default",
  input: TrackOrderRequest,
  output: OrderDetail,
  handler: async ({ input, client, mobileApp }) => {
    const order = await findTrackedOrder(input, client.ip);
    // The builder never reads `customerId`, which the lookup holds as the
    // account it read alongside. Its `payment` (Pay now) is left out of the
    // guest view by `toGuestOrderDetail`.
    return toGuestOrderDetail(
      await buildOrderDetail(order as unknown as IOrder, { appScheme: mobileApp.scheme }),
    );
  },
});
