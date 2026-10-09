import type {
  OrderAction,
  OrderAddress,
  OrderConsignment,
  OrderCustomer,
  OrderDetail,
  OrderLine,
  OrderListItem,
  OrderTimelineEvent,
  OrderTotals,
  OrderTracking,
} from "@/contracts/mobile/biz/v1/orders";
import { ORDER_STATUS } from "@/config/app.config";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import { consignmentCharge } from "@/lib/finance/postings";
import type { OrderTimelineEntry } from "@/lib/orders/order-details";
import { resolveVendorPaymentDisplayStatus } from "@/lib/orders/order-payment-status";
import type { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { getOrderStatusActions } from "@/lib/orders/order-status-workflow";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import type { VendorOrderDetail } from "@/lib/vendors/vendor-order-detail";

/**
 * The business app's order, from what the website's own readers return: one
 * mapper per view, both into the contract's shapes
 * (contracts/mobile/biz/v1/orders.ts).
 *
 * - The store's view (administrators, the store's staff, a seller's staff):
 *   the whole order as `getOrderDetails` reads it for the dashboard, and its
 *   timeline as `getOrderTimeline` does, both already scoped.
 * - A seller's view: their consignment, from the allow-list the website's
 *   vendor order page reads (`vendorOrderDetail`), and nothing of the order
 *   that list leaves out (other sellers' lines, the billing address, the
 *   store's notes and audit trail, the shopper's guest email).
 *
 * GET /orders/{id} answers with `toStoreOrderDetail` / `toSellerOrderDetail`,
 * and so does POST /orders/{id}/actions (B3) with the order after the step:
 * read it again through `loadOrderDetail` (./detail.ts) rather than mapping a
 * document here, so both answers hold the same order.
 *
 * `actions` is what the workflow offers next from where the order stands
 * (`getOrderStatusActions`, the web's own graph), for an operator who may
 * edit (and, for `cancel`, cancel) orders, and without `cancel` where
 * cancelling would send money back, which the app never does (D-B2). It is a
 * hint for the buttons; the action endpoint decides, and refuses with a
 * reason.
 */

type DateLike = Date | string | null | undefined;

interface RawLine {
  productId?: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  name?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  image?: string;
  purchaseType?: string;
}

interface RawConsignment {
  _id?: unknown;
  vendorId?: unknown;
  status?: string;
  paymentStatus?: string | null;
  items?: RawLine[];
  subtotal?: number;
  shippingCost?: number;
  couponDiscount?: number;
  shippingMethod?: { name?: string } | null;
  fulfillment?: { method?: string } | null;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: DateLike;
  deliveredAt?: DateLike;
}

interface RawAddress {
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
}

interface RawCustomer {
  _id?: unknown;
  name?: string;
  email?: string;
  phone?: string;
}

/** An order as the store's readers return it (lean, or JSON from `getOrderDetails`). */
export interface RawOrder {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  currency?: string;
  channel?: string;
  staffId?: unknown;
  customerId?: RawCustomer | unknown;
  guestEmail?: string;
  contactPhone?: string;
  items?: RawLine[];
  subOrders?: RawConsignment[];
  shippingAddress?: RawAddress;
  billingAddress?: RawAddress;
  digitalOnly?: boolean;
  shippingMethod?: { name?: string } | null;
  fulfillment?: { method?: string } | null;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  refundedTotal?: number;
  hasPreorder?: boolean;
  customerNote?: string;
  cancelledAt?: DateLike;
  cancelReason?: string;
  addressHold?: { state?: string; message?: string; deadlineAt?: DateLike } | null;
  createdAt?: DateLike;
  updatedAt?: DateLike;
  /** `getOrderDetails`: each consignment's seller, by vendor id, on a split order. */
  consignmentSellers?: Record<string, string>;
}

/** What the operator may do to orders in this workspace (`grantCan`). */
export interface OrderPowers {
  /** EDIT_ORDERS: move it along the workflow. */
  edit: boolean;
  /** CANCEL_ORDERS: call it off. */
  cancel: boolean;
}

/**
 * Where cancelling would send money back (`cancellationNeedsRefund`, read by
 * the loader from the whole order): the order as a whole, and each
 * consignment's own share by id. The app never refunds (D-B2), so `cancel`
 * is not offered there.
 */
export interface RefundDue {
  order: boolean;
  consignments: ReadonlySet<string>;
}

/** Every parcel of an order, as the order screens read them. */
type OrderShipmentTracking = Awaited<ReturnType<typeof loadOrderShipmentTracking>>;

/** A currency as `toMoney` takes it: a code, or the store's resolved one. */
type MoneyCurrency = Parameters<typeof toMoney>[1];

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const idOf = (value: unknown): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : String(value);

/** Leaves out every key whose value is undefined: the contract never sends `null`. */
function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/** The order's own currency, else the store's (orders from before it was kept). */
function currencyOf(order: { currency?: string }, store: MoneyCurrency): MoneyCurrency {
  return text(order.currency) ?? store;
}

const CANCELLABLE = new Set<string>([
  ORDER_STATUS.PREORDERED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
]);

/**
 * The workflow's next steps from `status`, as this operator may take them. A
 * parcel collected in person is never shipped, shipping waits while the
 * customer checks the address, and what has taken money is cancelled on the
 * website (`refundDue`).
 */
export function workflowActions(
  status: string | undefined,
  context: { powers: OrderPowers; pickup: boolean; addressHold: boolean; refundDue: boolean },
): OrderAction[] {
  if (!status) return [];
  const actions: OrderAction[] = [];
  for (const step of getOrderStatusActions(status)) {
    if (step.to === ORDER_STATUS.CANCELLED) {
      if (context.powers.cancel && !context.refundDue) actions.push("cancel");
      continue;
    }
    if (!context.powers.edit) continue;
    if (step.to === ORDER_STATUS.PROCESSING) actions.push("mark_processing");
    else if (step.to === ORDER_STATUS.SHIPPED) {
      if (!context.pickup && !context.addressHold) actions.push("mark_shipped");
    } else if (step.to === ORDER_STATUS.DELIVERED) actions.push("mark_delivered");
  }
  return actions;
}

export function toAddress(address: RawAddress | undefined): OrderAddress | undefined {
  if (!address || !text(address.street)) return undefined;
  return compact({
    name: nameOnAddress(address),
    street: text(address.street),
    apartment: text(address.apartment),
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.postalCode),
    country: text(address.country),
    phone: text(address.phone),
  });
}

function nameOnAddress(address: RawAddress | undefined): string | undefined {
  if (!address) return undefined;
  return text(address.fullName) ?? text([address.firstName, address.lastName].filter(Boolean).join(" "));
}

function populated(value: unknown): RawCustomer | undefined {
  return value && typeof value === "object" && ("name" in value || "email" in value)
    ? (value as RawCustomer)
    : undefined;
}

function toLine(item: RawLine, index: number, currency: MoneyCurrency): OrderLine {
  const quantity = Number(item.quantity ?? 0);
  const price = Number(item.price ?? 0);
  return compact({
    index,
    productId: String(item.productId ?? ""),
    variantId: idOf(item.variantId),
    name: String(item.name ?? ""),
    // As it was bought: the line's own snapshot, not the product's picture today.
    image: imageSet(item.image, item.name),
    sku: text(item.sku),
    quantity,
    unitPrice: toMoney(price, currency),
    lineTotal: toMoney(price * quantity, currency),
    preOrder: item.purchaseType === "preorder",
  });
}

const sumQuantities = (lines: RawLine[] | undefined) =>
  (lines ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);

/** What the shopper pays for one consignment: the ledger's share of the order, else its face value. */
function consignmentTotal(order: RawOrder, consignment: RawConsignment, currency: string): number {
  const charge = consignmentCharge(
    { ...(order as object), currency } as Parameters<typeof consignmentCharge>[0],
    consignment._id,
  );
  if (charge) return charge.total;
  return (
    Number(consignment.subtotal ?? 0) +
    Number(consignment.shippingCost ?? 0) -
    Number(consignment.couponDiscount ?? 0)
  );
}

function toTracking(
  tracking: OrderShipmentTracking | undefined,
  number: string | undefined,
  carrier: string | undefined,
): OrderTracking | undefined {
  const trackingNumber = text(number);
  if (!trackingNumber) return undefined;
  const parcel = tracking?.forTrackingNumber(trackingNumber, text(carrier));
  return compact({
    number: trackingNumber,
    carrier: text(carrier) ?? text(parcel?.carrierName),
    url: text(parcel?.trackingUrl),
  });
}

function openAddressHold(order: Pick<RawOrder, "addressHold">): OrderDetail["addressHold"] {
  const hold = order.addressHold;
  if (!hold || hold.state !== "open") return undefined;
  return compact({ message: text(hold.message), deadlineAt: iso(hold.deadlineAt) });
}

/** The name a list row shows: nobody for a walk-in, else the account's, else the address's. */
function customerNameOf(order: RawOrder): string | undefined {
  if (isPosWalkIn(order)) return undefined;
  return text(populated(order.customerId)?.name) ?? nameOnAddress(order.shippingAddress);
}

// ---------------------------------------------------------------------------
// The store's view
// ---------------------------------------------------------------------------

/** One row of the store's list (a row of `ORDER_LIST_FIELDS`, the customer's name populated). */
export function toStoreOrderListItem(order: RawOrder, storeCurrency: MoneyCurrency): OrderListItem {
  return compact({
    id: String(order._id),
    number: String(order.orderNumber ?? ""),
    status: String(order.status ?? ""),
    paymentStatus: String(order.paymentStatus ?? ""),
    placedAt: iso(order.createdAt) ?? new Date(0).toISOString(),
    customerName: customerNameOf(order),
    itemCount: sumQuantities(order.items),
    total: toMoney(order.total, currencyOf(order, storeCurrency)),
    preOrder: order.hasPreorder === true,
    channel: text(order.channel),
  });
}

function storeCustomer(order: RawOrder): OrderCustomer {
  if (isPosWalkIn(order)) return {};
  const account = populated(order.customerId);
  return compact({
    name: text(account?.name) ?? nameOnAddress(order.shippingAddress),
    email: text(account?.email) ?? text(order.guestEmail),
    phone: text(account?.phone) ?? text(order.contactPhone) ?? text(order.shippingAddress?.phone),
  });
}

function storeTotals(order: RawOrder, currency: MoneyCurrency): OrderTotals {
  const refunded = Number(order.refundedTotal ?? 0);
  return compact({
    subtotal: toMoney(order.subtotal, currency),
    shipping: toMoney(order.shippingCost, currency),
    tax: toMoney(order.tax, currency),
    discount: toMoney(order.discount, currency),
    total: toMoney(order.total, currency),
    refunded: refunded > 0 ? toMoney(refunded, currency) : undefined,
  });
}

function toTimelineEvent(entry: OrderTimelineEntry): OrderTimelineEvent {
  if (entry.kind === "comment") {
    return compact({
      at: entry.createdAt,
      kind: "note",
      message: entry.body ?? "",
      by: text(entry.authorName),
    });
  }
  const action = String(entry.action ?? "");
  return compact({
    at: entry.createdAt,
    kind: action === "CREATE" ? "placed" : action.toLowerCase(),
    message: text(entry.summary) ?? action.toLowerCase().replace(/_/g, " "),
    by: text(entry.userEmail),
  });
}

/**
 * The whole order, for the store's operators.
 *
 * `vendorScoped`: a seller's staff, who act on their seller's whole orders
 * only and never on one consignment of a split one (they cannot see those).
 */
export function toStoreOrderDetail(
  order: RawOrder,
  extra: {
    storeCurrency: MoneyCurrency;
    timeline: OrderTimelineEntry[];
    tracking?: OrderShipmentTracking;
    powers: OrderPowers;
    refundDue: RefundDue;
    vendorScoped: boolean;
  },
): OrderDetail {
  const currency = currencyOf(order, extra.storeCurrency);
  const code = typeof currency === "string" ? currency : currency.code;
  const items = order.items ?? [];
  const consignments = order.subOrders ?? [];
  const addressHold = openAddressHold(order);
  const split = consignments.length > 1;

  return compact({
    id: String(order._id),
    number: String(order.orderNumber ?? ""),
    status: String(order.status ?? ""),
    paymentStatus: String(order.paymentStatus ?? ""),
    paymentMethod: String(order.paymentMethod ?? ""),
    placedAt: iso(order.createdAt) ?? new Date(0).toISOString(),
    channel: text(order.channel),
    cancelledAt: order.status === ORDER_STATUS.CANCELLED ? iso(order.cancelledAt) : undefined,
    cancelReason: order.status === ORDER_STATUS.CANCELLED ? text(order.cancelReason) : undefined,
    customer: storeCustomer(order),
    lines: items.map((item, index) => toLine(item, index, currency)),
    totals: storeTotals(order, currency),
    // A digital-only order keeps a copy of the billing address there.
    shippingAddress: order.digitalOnly ? undefined : toAddress(order.shippingAddress),
    billingAddress: toAddress(order.billingAddress),
    shippingMethod: text(order.shippingMethod?.name),
    consignments: consignments.map((consignment): OrderConsignment => {
      const vendorId = idOf(consignment.vendorId);
      const pickup = consignment.fulfillment?.method === "pickup";
      return compact({
        id: String(consignment._id ?? ""),
        vendorId,
        vendorName: vendorId ? order.consignmentSellers?.[vendorId] : undefined,
        status: String(consignment.status ?? ""),
        lineIndexes: items.reduce<number[]>((acc, item, index) => {
          if (vendorId && idOf(item.vendorId) === vendorId) acc.push(index);
          return acc;
        }, []),
        total: toMoney(consignmentTotal(order, consignment, code), currency),
        pickup,
        tracking: toTracking(extra.tracking, consignment.trackingNumber, consignment.carrier),
        shippedAt: iso(consignment.shippedAt),
        deliveredAt: iso(consignment.deliveredAt),
        // One seller's part of a split order can be called off on its own
        // (the website's consignment cancel), unless its share was paid;
        // moving it along is the order's.
        actions:
          split &&
          !extra.vendorScoped &&
          extra.powers.cancel &&
          CANCELLABLE.has(String(consignment.status ?? "")) &&
          !extra.refundDue.consignments.has(String(consignment._id ?? ""))
            ? (["cancel"] as OrderAction[])
            : [],
      });
    }),
    customerNote: text(order.customerNote),
    addressHold,
    timeline: extra.timeline.map(toTimelineEvent),
    actions: workflowActions(order.status, {
      powers: extra.powers,
      pickup: order.fulfillment?.method === "pickup",
      addressHold: Boolean(addressHold),
      refundDue: extra.refundDue.order,
    }),
    updatedAt: iso(order.updatedAt) ?? iso(order.createdAt) ?? new Date(0).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// A seller's view
// ---------------------------------------------------------------------------

function sellerConsignment(order: RawOrder, vendorId: string): RawConsignment | undefined {
  return (order.subOrders ?? []).find((consignment) => idOf(consignment.vendorId) === vendorId);
}

/** One row of a seller's list: their consignment of the order. */
export function toSellerOrderListItem(
  order: RawOrder,
  vendorId: string,
  storeCurrency: MoneyCurrency,
): OrderListItem {
  const consignment = sellerConsignment(order, vendorId) ?? {};
  const currency = currencyOf(order, storeCurrency);
  const code = typeof currency === "string" ? currency : currency.code;
  return compact({
    id: String(order._id),
    number: String(order.orderNumber ?? ""),
    status: String(consignment.status ?? ORDER_STATUS.PENDING),
    paymentStatus: resolveVendorPaymentDisplayStatus(
      order as Parameters<typeof resolveVendorPaymentDisplayStatus>[0],
      consignment as Parameters<typeof resolveVendorPaymentDisplayStatus>[1],
    ),
    placedAt: iso(order.createdAt) ?? new Date(0).toISOString(),
    customerName: customerNameOf(order),
    itemCount: sumQuantities(consignment.items),
    total: toMoney(consignmentTotal(order, consignment, code), currency),
    preOrder: (consignment.items ?? []).some((line) => line.purchaseType === "preorder"),
    channel: text(order.channel),
  });
}

/** The seller's consignment's own steps, newest first. */
function sellerTimeline(
  detail: VendorOrderDetail,
  consignment: RawConsignment,
  order: Pick<RawOrder, "cancelledAt">,
): OrderTimelineEvent[] {
  const events: OrderTimelineEvent[] = [];
  const placedAt = iso(detail.createdAt);
  if (placedAt) events.push({ at: placedAt, kind: "placed", message: "Order placed" });
  const shippedAt = iso(consignment.shippedAt);
  if (shippedAt) {
    const parcel = [text(consignment.carrier), text(consignment.trackingNumber)].filter(Boolean).join(" ");
    events.push({ at: shippedAt, kind: "shipped", message: parcel ? `Shipped: ${parcel}` : "Shipped" });
  }
  const deliveredAt = iso(consignment.deliveredAt);
  if (deliveredAt) events.push({ at: deliveredAt, kind: "delivered", message: "Delivered" });
  const cancelledAt = consignment.status === ORDER_STATUS.CANCELLED ? iso(order.cancelledAt) : undefined;
  if (cancelledAt) events.push({ at: cancelledAt, kind: "cancelled", message: "Cancelled" });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A seller's order: their consignment, from the website's vendor view of it.
 * `order` is the same document the view was built from; only its version,
 * channel and cancellation time are read off it.
 */
export function toSellerOrderDetail(
  detail: VendorOrderDetail,
  order: Pick<RawOrder, "updatedAt" | "channel" | "cancelledAt" | "status">,
  extra: {
    storeCurrency: MoneyCurrency;
    vendorName: string;
    tracking?: OrderShipmentTracking;
    powers: OrderPowers;
    /** Cancelling their consignment would refund its share. */
    refundDue: boolean;
  },
): OrderDetail {
  const consignment = detail.subOrders[0] as unknown as RawConsignment;
  const currency = detail.finance.currency || extra.storeCurrency;
  const charge = detail.finance.charge;
  const lines = consignment.items ?? [];
  const subtotal = Number(consignment.subtotal ?? 0);
  const shipping = charge ? charge.shipping : Number(consignment.shippingCost ?? 0);
  const discount = charge
    ? Math.max(0, subtotal - charge.merchandise)
    : Number(consignment.couponDiscount ?? 0);
  const pickup = consignment.fulfillment?.method === "pickup";
  const addressHold = openAddressHold(detail as Pick<RawOrder, "addressHold">);
  const actions = workflowActions(consignment.status, {
    powers: extra.powers,
    pickup,
    addressHold: Boolean(addressHold),
    refundDue: extra.refundDue,
  });
  const customer = populated(detail.customerId);

  return compact({
    id: String(detail._id),
    number: String(detail.orderNumber ?? ""),
    status: String(consignment.status ?? ORDER_STATUS.PENDING),
    paymentStatus: String(detail.paymentStatus ?? ""),
    paymentMethod: String(detail.paymentMethod ?? ""),
    placedAt: iso(detail.createdAt) ?? new Date(0).toISOString(),
    channel: text(order.channel),
    cancelledAt: consignment.status === ORDER_STATUS.CANCELLED ? iso(order.cancelledAt) : undefined,
    customer: detail.posWalkIn
      ? {}
      : compact({
          name: text(customer?.name) ?? nameOnAddress(detail.shippingAddress as RawAddress | undefined),
          email: text(customer?.email),
          phone: text((detail.shippingAddress as RawAddress | undefined)?.phone),
        }),
    lines: lines.map((line, index) => toLine(line, index, currency)),
    totals: {
      subtotal: toMoney(subtotal, currency),
      shipping: toMoney(shipping, currency),
      tax: toMoney(charge?.tax ?? 0, currency),
      discount: toMoney(discount, currency),
      total: toMoney(charge ? charge.total : subtotal + shipping - discount, currency),
    },
    shippingAddress: toAddress(detail.shippingAddress as RawAddress | undefined),
    shippingMethod: text(consignment.shippingMethod?.name),
    consignments: [
      compact({
        id: String(consignment._id ?? ""),
        vendorId: idOf(consignment.vendorId),
        vendorName: text(extra.vendorName),
        status: String(consignment.status ?? ORDER_STATUS.PENDING),
        lineIndexes: lines.map((_line, index) => index),
        total: toMoney(charge ? charge.total : subtotal + shipping - discount, currency),
        pickup,
        tracking: toTracking(extra.tracking, consignment.trackingNumber, consignment.carrier),
        shippedAt: iso(consignment.shippedAt),
        deliveredAt: iso(consignment.deliveredAt),
        actions,
      }),
    ],
    customerNote: text(detail.customerNote),
    addressHold,
    timeline: sellerTimeline(detail, consignment, order),
    // Their consignment is all of the order they see, and what they act on.
    actions,
    updatedAt: iso(order.updatedAt) ?? iso(detail.createdAt) ?? new Date(0).toISOString(),
  });
}
