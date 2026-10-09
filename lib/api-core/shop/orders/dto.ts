import type {
  OrderAddress,
  OrderAddressHold,
  OrderDetail,
  OrderLine,
  OrderPickup,
  OrderPreOrder,
  OrderPreOrderDetail,
  OrderShipment,
  OrderSummary,
  OrderTotals,
  OrderTracking,
} from "@/contracts/mobile/shop/v1/orders";
import { isCancellableByCustomer } from "@/lib/orders/customer-cancel-policy";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";
import { imageSet } from "../images";
import { toMoney } from "../money";

/**
 * An order, as the mobile contract shows it to the person who placed it
 * (contracts … orders.ts). The input is what `sanitizeOrdersForCustomer`
 * returns: the seller's economics are already gone, and `subOrders` holds the
 * consignments only on an order several sellers ship.
 */

type DateLike = Date | string | null | undefined;

type RawAddress = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  street?: string;
  apartment?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
};

type RawItem = {
  productId?: unknown;
  variantId?: unknown;
  name?: string;
  image?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  purchaseType?: string;
  preorderStatus?: string;
  preorderReleaseDate?: DateLike;
  finalSale?: boolean;
};

type RawConsignment = {
  vendorName?: string;
  status: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;
  itemIndexes: number[];
};

export type CustomerOrder = {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  currency?: string;
  createdAt?: DateLike;
  cancelledAt?: DateLike;
  items?: RawItem[];
  subOrders: RawConsignment[];
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  refundedTotal?: number;
  storeCredit?: { applied?: number; state?: string };
  digitalOnly?: boolean;
  shippingAddress?: RawAddress;
  billingAddress?: RawAddress;
  shippingMethod?: { name?: string };
  fulfillment?: {
    method?: string;
    pickup?: {
      pickupLocationName?: string;
      pickupAddress?: string;
      instructions?: string;
      startAt?: DateLike;
      endAt?: DateLike;
      status?: string;
    };
  };
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderReleaseDate?: DateLike;
  preorderOriginalReleaseDate?: DateLike;
  preorderDelayReason?: string;
  addressHold?: {
    state?: unknown;
    message?: unknown;
    deadlineAt?: unknown;
    customerConfirmedAt?: unknown;
  };
  customerNote?: string;
};

/** A parcel as `loadOrderShipmentTracking` reads it. */
type ParcelTracking = {
  trackingUrl?: string;
  carrierName?: string;
  events: Array<{ at: DateLike; status: string; description?: string; location?: string }>;
  exception?: { code: string; message: string; at: DateLike };
};

/** What a pre-order with a balance has paid and still owes. */
type PreOrderBalance = {
  balanceDue: number;
  paidSoFar: number;
  deadline: Date | null;
  /** The website's signed page that takes the balance. */
  payUrl?: string;
};

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Leaves out every key whose value is undefined: the contract never sends `null`. */
function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

export function orderCurrency(order: { currency?: string }, storeCurrency: string): string {
  return text(order.currency) ?? storeCurrency;
}

/** The order's own pre-order facts, else its first pre-order line's (as the account page reads them). */
function preOrderOf(order: CustomerOrder): OrderPreOrder | undefined {
  if (!order.hasPreorder) return undefined;
  const line = (order.items ?? []).find((item) => item.purchaseType === "preorder");
  return compact({
    status: text(order.preorderStatus) ?? text(line?.preorderStatus),
    releaseDate: iso(order.preorderReleaseDate) ?? iso(line?.preorderReleaseDate),
  });
}

/**
 * `balanceDue`: what a pre-order still owes (`getPreorderBalanceDue`), read
 * off the stored order by the list, since the sanitizer strips what it needs.
 */
export function toOrderSummary(
  order: CustomerOrder,
  storeCurrency: string,
  balanceDue = 0,
): OrderSummary {
  const currency = orderCurrency(order, storeCurrency);
  const preOrder = preOrderOf(order);
  return compact({
    id: String(order._id),
    number: String(order.orderNumber ?? ""),
    status: String(order.status ?? ""),
    placedAt: iso(order.createdAt) ?? new Date(0).toISOString(),
    itemCount: (order.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    total: toMoney(order.total, currency),
    preOrder:
      preOrder && balanceDue > 0
        ? { ...preOrder, balanceDue: toMoney(balanceDue, currency) }
        : preOrder,
    shipments: order.subOrders.map((consignment) =>
      compact({ vendorName: text(consignment.vendorName), status: consignment.status }),
    ),
  });
}

function toAddress(address: RawAddress | undefined): OrderAddress | undefined {
  if (!address || !text(address.street)) return undefined;
  const name =
    text(address.fullName) ??
    text([address.firstName, address.lastName].filter(Boolean).join(" "));
  return compact({
    name,
    street: text(address.street),
    apartment: text(address.apartment),
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.postalCode),
    country: text(address.country),
    phone: text(address.phone),
  });
}

function toLine(
  item: RawItem,
  index: number,
  currency: string,
  slugs: ReadonlyMap<string, string>,
): OrderLine {
  const quantity = Number(item.quantity ?? 0);
  const price = Number(item.price ?? 0);
  const isPreOrder = item.purchaseType === "preorder";
  const productId = String(item.productId ?? "");
  return compact({
    index,
    productId,
    slug: slugs.get(productId),
    variantId: item.variantId ? String(item.variantId) : undefined,
    name: String(item.name ?? ""),
    // As it was bought: the line's own snapshot, not the product's picture today.
    image: imageSet(item.image, item.name),
    sku: text(item.sku),
    quantity,
    unitPrice: toMoney(price, currency),
    lineTotal: toMoney(price * quantity, currency),
    preOrder: isPreOrder
      ? compact({ status: text(item.preorderStatus), releaseDate: iso(item.preorderReleaseDate) })
      : undefined,
    finalSale: item.finalSale === true,
  });
}

function toTracking(
  parcel: ParcelTracking,
  number: string | undefined,
  carrier: string | undefined,
): OrderTracking | undefined {
  const trackingNumber = text(number);
  const carrierName = text(carrier) ?? text(parcel.carrierName);
  if (!trackingNumber && !parcel.trackingUrl && parcel.events.length === 0 && !parcel.exception) {
    return undefined;
  }
  return compact({
    number: trackingNumber,
    carrier: carrierName,
    url: text(parcel.trackingUrl),
    events: parcel.events.map((event) =>
      compact({
        at: iso(event.at) ?? new Date(0).toISOString(),
        status: String(event.status ?? ""),
        description: text(event.description),
        location: text(event.location),
      }),
    ),
    exception: parcel.exception
      ? {
          code: parcel.exception.code,
          message: parcel.exception.message,
          at: iso(parcel.exception.at) ?? new Date(0).toISOString(),
        }
      : undefined,
  });
}

function toTotals(order: CustomerOrder, currency: string): OrderTotals {
  const storeCredit = Number(order.storeCredit?.applied ?? 0);
  const refunded = Number(order.refundedTotal ?? 0);
  return compact({
    subtotal: toMoney(order.subtotal, currency),
    shipping: toMoney(order.shippingCost, currency),
    tax: toMoney(order.tax, currency),
    discount: toMoney(order.discount, currency),
    // Released credit went back to the shopper's balance: it paid nothing.
    storeCredit:
      order.storeCredit?.state !== "released" && storeCredit > 0
        ? toMoney(storeCredit, currency)
        : undefined,
    total: toMoney(order.total, currency),
    refunded: refunded > 0 ? toMoney(refunded, currency) : undefined,
  });
}

function toPickup(order: CustomerOrder): OrderPickup | undefined {
  const pickup = order.fulfillment?.method === "pickup" ? order.fulfillment.pickup : undefined;
  const startAt = iso(pickup?.startAt);
  const endAt = iso(pickup?.endAt);
  if (!pickup || !text(pickup.pickupAddress) || !startAt || !endAt) return undefined;
  return compact({
    locationName: text(pickup.pickupLocationName),
    address: String(pickup.pickupAddress),
    instructions: text(pickup.instructions),
    startAt,
    endAt,
    status: String(pickup.status ?? "scheduled"),
  });
}

function toAddressHold(order: CustomerOrder): OrderAddressHold | undefined {
  const hold = order.addressHold;
  if (!hold || hold.state !== "open") return undefined;
  return compact({
    message: text(hold.message),
    deadlineAt: iso(hold.deadlineAt),
    confirmedAt: iso(hold.customerConfirmedAt),
  });
}

function toPreOrderDetail(
  order: CustomerOrder,
  balance: PreOrderBalance | null,
  currency: string,
): OrderPreOrderDetail | undefined {
  const base = preOrderOf(order);
  if (!base) return undefined;
  const owes = balance && balance.balanceDue > 0;
  return compact({
    ...base,
    originalReleaseDate: iso(order.preorderOriginalReleaseDate),
    delayReason: text(order.preorderDelayReason),
    paidSoFar: owes ? toMoney(balance.paidSoFar, currency) : undefined,
    balanceDue: owes ? toMoney(balance.balanceDue, currency) : undefined,
    balanceDueBy: owes ? iso(balance.deadline) : undefined,
    balancePayUrl: owes ? balance.payUrl : undefined,
  });
}

export function toOrderDetail(
  order: CustomerOrder,
  extra: {
    storeCurrency: string;
    /** The order-level parcel. */
    tracking: ParcelTracking;
    /** Each consignment's parcel, by its tracking number and courier. */
    trackingFor: (trackingNumber?: string, carrier?: string) => ParcelTracking;
    preOrderBalance: PreOrderBalance | null;
    /** "Pay now", on the shopper's own order. */
    payment?: OrderDetail["payment"];
    /** Each line's product's page address, by product id (`productSlugsOf`): a deleted product has none. */
    slugs: ReadonlyMap<string, string>;
  },
): OrderDetail {
  const currency = orderCurrency(order, extra.storeCurrency);
  const shipments: OrderShipment[] = order.subOrders.map((consignment) =>
    compact({
      vendorName: text(consignment.vendorName),
      status: consignment.status,
      lineIndexes: consignment.itemIndexes,
      shippedAt: consignment.shippedAt,
      deliveredAt: consignment.deliveredAt,
      tracking: toTracking(
        extra.trackingFor(consignment.trackingNumber, consignment.carrier),
        consignment.trackingNumber,
        consignment.carrier,
      ),
    }),
  );
  const orderLevel = order as CustomerOrder & { trackingNumber?: string; carrier?: string };

  return compact({
    id: String(order._id),
    number: String(order.orderNumber ?? ""),
    status: String(order.status ?? ""),
    paymentStatus: String(order.paymentStatus ?? ""),
    paymentMethod: String(order.paymentMethod ?? ""),
    placedAt: iso(order.createdAt) ?? new Date(0).toISOString(),
    cancelledAt: iso(order.cancelledAt),
    canCancel: isCancellableByCustomer(order) && !getPendingPaymentLock(order),
    lines: (order.items ?? []).map((item, index) => toLine(item, index, currency, extra.slugs)),
    totals: toTotals(order, currency),
    // A digital-only order keeps a copy of the billing address there.
    shippingAddress: order.digitalOnly ? undefined : toAddress(order.shippingAddress),
    billingAddress: toAddress(order.billingAddress),
    shippingMethod: text(order.shippingMethod?.name),
    pickup: toPickup(order),
    // On an order several sellers ship, each consignment carries its own.
    tracking:
      shipments.length > 0
        ? undefined
        : toTracking(extra.tracking, orderLevel.trackingNumber, orderLevel.carrier),
    shipments,
    preOrder: toPreOrderDetail(order, extra.preOrderBalance, currency),
    addressHold: toAddressHold(order),
    note: text(order.customerNote),
    payment: extra.payment,
  });
}
