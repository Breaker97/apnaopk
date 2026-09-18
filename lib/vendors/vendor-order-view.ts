import { resolveVendorPaymentDisplayStatus } from "@/lib/orders/order-payment-status";

/**
 * The part of an order a vendor is allowed to see — built from an allow-list,
 * never by spreading the order.
 *
 * An order document is shared by every seller on it and by the store. Handing
 * it to a vendor whole shipped the other sellers' lines, unit costs,
 * commission and earnings, the store's gateway references and wallet tokens,
 * and the shopper's billing details and notes to whichever vendor happened to
 * update their parcel. `GET /api/vendor/orders/[id]` was already an allow-list;
 * the write routes and the order list answered with the document.
 *
 * Carries what a vendor needs to act on their own consignment: who it goes to,
 * how it was paid for, and their own sub-order. Anything richer (the finance
 * block) is added by the one route that computes it.
 */

type VendorViewSubOrder = {
  vendorId?: { toString(): string } | string | null;
  status?: string;
  paymentStatus?: string | null;
};

type VendorViewOrder = {
  _id?: unknown;
  orderNumber?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  status?: string;
  currency?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  shippingAddress?: unknown;
  customerId?: unknown;
  digitalOnly?: boolean;
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderReleaseDate?: Date | string;
  subOrders?: VendorViewSubOrder[] | null;
};

/** A Mongoose document or a lean object, read the same way. */
function toPlain<T>(value: T): T {
  const candidate = value as T & { toObject?: () => T };
  return typeof candidate?.toObject === "function" ? candidate.toObject() : value;
}

/**
 * The vendor-facing copy of `order`, narrowed to `vendorId`'s consignment.
 *
 * `customerId` passes through as given, so a caller that populated it with the
 * customer's name and email shows those and one that did not shows an id.
 */
export function toVendorOrderView<TOrder>(
  order: TOrder,
  vendorId: { toString(): string } | string,
) {
  const plain = toPlain(order) as unknown as VendorViewOrder;
  const vendorKey = String(vendorId);
  const subOrders = (plain.subOrders || []).filter(
    (sub) => String(sub?.vendorId ?? "") === vendorKey,
  );

  return {
    _id: plain._id,
    orderNumber: plain.orderNumber,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    status: plain.status,
    currency: plain.currency,
    paymentMethod: plain.paymentMethod,
    // This vendor's own payment state, not the order's — see the resolver.
    paymentStatus: resolveVendorPaymentDisplayStatus(plain, subOrders[0]),
    shippingAddress: plain.shippingAddress,
    customerId: plain.customerId,
    digitalOnly: plain.digitalOnly,
    hasPreorder: plain.hasPreorder,
    preorderStatus: plain.preorderStatus,
    preorderReleaseDate: plain.preorderReleaseDate,
    subOrders,
  };
}
