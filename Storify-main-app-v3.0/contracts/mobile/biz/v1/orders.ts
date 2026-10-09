/**
 * Orders: the list, one order, and the workflow's next step.
 *
 * Who sees what follows the website's dashboards: an administrator sees every
 * order; the store's staff see the orders of the sellers in their scope; a
 * seller sees the orders with a consignment of theirs, and on each only their
 * own consignment (its lines, its totals, its status); a seller's staff see
 * orders that are wholly their seller's. An order out of reach answers 404,
 * never 403.
 *
 * Statuses are the store's own words (`pending`, `processing`, `shipped`,
 * `delivered`, `cancelled`, `preordered`), passed through: the app shows its
 * own translation of the ones it knows and the word itself otherwise.
 *
 * GET /orders and GET /orders/{id} answer 304 to a matching `If-None-Match`.
 * Read the list again on a push about an order (`order_placed`,
 * `order_status`), on pull to refresh, and on returning to the foreground;
 * there is no live stream. A checkout abandoned at a payment gateway is not
 * an order and is in no list.
 *
 * Read schemas: session B2. Action schemas (`OrderAction…`): session B3.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

/**
 * The list's tabs. For a seller each is about their own consignment (its
 * status, its lines), for everyone else about the order:
 * - `needs_action`: placed and not yet shipped (pending, processing). The
 *   Home tile `ORDERS_NEEDING_ACTION` counts exactly this tab.
 * - `pre_orders`: with a pre-order line, not yet shipped (preordered,
 *   pending, processing).
 * - `shipped`, `delivered`, `cancelled`: by status.
 * - `all`: everything (the default).
 * Tabs filter, they do not split: an order can be in two (`needs_action` and
 * `pre_orders`), and every order is in `all`.
 */
export const ORDER_LIST_TABS = [
  "needs_action",
  "pre_orders",
  "shipped",
  "delivered",
  "cancelled",
  "all",
] as const;

/**
 * GET /orders. Newest first. The cursor continues after the last order shown,
 * so an order placed while scrolling never repeats a row; it appears on the
 * next read of the first page.
 */
export const OrderListQuery = ListQuery.extend({
  tab: z.enum(ORDER_LIST_TABS).optional(),
  /**
   * Part of the order number, or of a registered customer's name, email or
   * phone, or a guest's email. Case does not matter.
   */
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * One customer's orders: their `id` from GET /customers (or an order's
   * `customer.id`), with `tab` and `search` as usual. A customer out of
   * reach has no orders here.
   */
  customerId: z.string().min(1).max(64).optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

/**
 * An order as the list shows it. For a seller, their own consignment of it:
 * its status, its payment, its lines and what the shopper pays for it.
 */
export const OrderListItem = z.object({
  id: z.string(),
  /** The number the store and the customer quote. */
  number: z.string(),
  status: z.string(),
  /** `pending`, `paid`, `partially_paid`, `refunded`, `partially_refunded`, `expired`. */
  paymentStatus: z.string(),
  placedAt: z.string(),
  /** Left out for a walk-in sale at the counter, which names nobody. */
  customerName: z.string().optional(),
  /** The quantities added up. */
  itemCount: z.number().int(),
  total: Money,
  /** Has a pre-order on it. */
  preOrder: z.boolean(),
  /** Where it was placed: `online`, `pos`, … (the store's own word). */
  channel: z.string().optional(),
});
export type OrderListItem = z.infer<typeof OrderListItem>;

export const OrderList = listOf(OrderListItem);
export type OrderList = z.infer<typeof OrderList>;

/** Who placed the order, as far as the operator may see them. */
export const OrderCustomer = z.object({
  /**
   * The customer, for GET /customers/{id}: sent to an operator who may see
   * customers (`VIEW_ORDER_CUSTOMERS`), when the order is a shopper
   * account's or a guest's the store keeps a customer record for (not a
   * walk-in sale).
   */
  id: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});
export type OrderCustomer = z.infer<typeof OrderCustomer>;

export const OrderLine = z.object({
  /**
   * The line's position, which never changes: in the order, or for a seller
   * in their consignment. `OrderConsignment.lineIndexes` uses the same.
   */
  index: z.number().int(),
  productId: z.string(),
  variantId: z.string().optional(),
  name: z.string(),
  /** The variant's options, as the store names them ("Red / XL"). */
  variantName: z.string().optional(),
  image: ImageSet.optional(),
  sku: z.string().optional(),
  quantity: z.number().int(),
  unitPrice: Money,
  lineTotal: Money,
  /** A pre-order line, waiting for stock. */
  preOrder: z.boolean(),
});
export type OrderLine = z.infer<typeof OrderLine>;

/** An address as it was written on the order. */
export const OrderAddress = z.object({
  name: z.string().optional(),
  street: z.string().optional(),
  apartment: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
});
export type OrderAddress = z.infer<typeof OrderAddress>;

/** What an order (or a seller's consignment of it) comes to. */
export const OrderTotals = z.object({
  subtotal: Money,
  shipping: Money,
  tax: Money,
  discount: Money,
  total: Money,
  /** Money given back so far. */
  refunded: Money.optional(),
});
export type OrderTotals = z.infer<typeof OrderTotals>;

/**
 * The steps `POST /orders/{id}/actions` takes:
 * - `mark_processing`: pending or pre-ordered → processing.
 * - `mark_shipped`: processing → shipped; send `carrier` and `trackingNumber`.
 * - `mark_delivered`: shipped → delivered (cash on delivery is then collected).
 * - `cancel`: pending, pre-ordered or processing → cancelled; send `reason`.
 */
export const ORDER_ACTIONS = [
  "mark_processing",
  "mark_shipped",
  "mark_delivered",
  "cancel",
] as const;
export const OrderAction = z.enum(ORDER_ACTIONS);
export type OrderAction = z.infer<typeof OrderAction>;

/** A parcel: where to follow it. */
export const OrderTracking = z.object({
  carrier: z.string().optional(),
  number: z.string().optional(),
  /** The courier's tracking page, to open in a browser. */
  url: z.string().optional(),
});
export type OrderTracking = z.infer<typeof OrderTracking>;

/** One seller's part of an order: what they ship, and where it stands. */
export const OrderConsignment = z.object({
  id: z.string(),
  /** Left out on a store that has no sellers. */
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  status: z.string(),
  /** The `index` of each line in it. */
  lineIndexes: z.array(z.number().int()),
  total: Money,
  /** Collected from the seller's location instead of delivered. */
  pickup: z.boolean(),
  tracking: OrderTracking.optional(),
  shippedAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  /**
   * What this operator may do to this consignment alone now. The store's
   * operators: `cancel` one seller's part of a split order (send
   * `consignmentId`). A seller: their consignment's next step and cancel.
   * `cancel` is left out where cancelling would give money back (the app
   * never refunds: that cancel is made on the website).
   */
  actions: z.array(OrderAction),
});
export type OrderConsignment = z.infer<typeof OrderConsignment>;

/**
 * One thing that happened to the order, newest first in the timeline.
 *
 * The store's operators see what the website's order timeline shows: its
 * events and the notes their team wrote (a seller's staff only their own
 * team's notes). A seller sees their consignment's own steps.
 */
export const OrderTimelineEvent = z.object({
  at: z.string(),
  /**
   * The store's own word for it: `placed`, `status_change`, `status_override`,
   * `payment`, `refund`, `update`, `note` (written by the team), and for a
   * seller `shipped`, `delivered`, `cancelled`.
   */
  kind: z.string(),
  /** What happened, as the store recorded it (English for its events). */
  message: z.string(),
  /** Who did it, when a person did. */
  by: z.string().optional(),
});
export type OrderTimelineEvent = z.infer<typeof OrderTimelineEvent>;

/** GET /orders/{id}, and the order an action answers with. */
export const OrderDetail = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  /** The store's code for it: `cod`, `stripe`, `paypal`, … */
  paymentMethod: z.string(),
  placedAt: z.string(),
  channel: z.string().optional(),
  /** When it was cancelled, on a cancelled order. */
  cancelledAt: z.string().optional(),
  /** Why, as the person who cancelled it wrote it. */
  cancelReason: z.string().optional(),
  customer: OrderCustomer,
  /** For a seller, only the lines of their consignment. */
  lines: z.array(OrderLine),
  totals: OrderTotals,
  shippingAddress: OrderAddress.optional(),
  billingAddress: OrderAddress.optional(),
  /** The delivery option chosen at checkout. */
  shippingMethod: z.string().optional(),
  /** For a seller, only their own. */
  consignments: z.array(OrderConsignment),
  /** The note the customer left at checkout. */
  customerNote: z.string().optional(),
  /**
   * Shipping is paused until the customer checks the delivery address: sent
   * only while it is. Shipping actions are refused meanwhile.
   */
  addressHold: z
    .object({
      message: z.string().optional(),
      deadlineAt: z.string().optional(),
    })
    .optional(),
  timeline: z.array(OrderTimelineEvent),
  /**
   * What this operator may do to the whole order now: the workflow's next
   * step and cancel, as their permissions allow, without `cancel` where
   * cancelling would give money back (the app never refunds: that cancel is
   * made on the website). For a seller, to their consignment (the same list
   * as on it), judged as the whole order when it is the last one left. A
   * hint for the buttons: the action itself may still be refused, with a
   * reason.
   */
  actions: z.array(OrderAction),
  /** When it last changed (ISO 8601). */
  updatedAt: z.string(),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

/**
 * POST /orders/{id}/actions: take the workflow's next step. Send
 * `Idempotency-Key`: a retry with the same key gets the first answer, and
 * the step, its stock and its notifications happen once.
 *
 * A seller acts on their own consignment, so leaves `consignmentId` out. The
 * store's operators send it only with `cancel`, to call off one seller's
 * part of a split order instead of the whole order (the website's
 * consignment cancel, which asks for a `reason`); a seller's staff never
 * send it (they act on their seller's whole orders).
 *
 * `cancel` from the app never refunds: an order (or a consignment) that has
 * taken money answers `CANCEL_NEEDS_REFUND`, and is cancelled on the
 * website, where the refund is made. A payment that lands while the cancel
 * is being made answers `ORDER_STATE_CHANGED`, with the order now paid.
 */
export const OrderActionRequest = z.object({
  action: OrderAction,
  consignmentId: z.string().min(1).max(64).optional(),
  /** `mark_shipped`: required with `trackingNumber`. */
  carrier: z.string().trim().min(1).max(100).optional(),
  trackingNumber: z.string().trim().min(1).max(100).optional(),
  /** `cancel`: why, kept on the order's timeline (required with `consignmentId`). */
  reason: z.string().trim().min(1).max(500).optional(),
});
export type OrderActionRequest = z.infer<typeof OrderActionRequest>;

/**
 * `reason` values of POST /orders/{id}/actions, next to the code. The
 * `message` beside each is the website's own sentence for it, for a reason
 * the app does not know.
 * - 409 CONFLICT:
 *   - `ORDER_STATE_CHANGED`: somebody else changed the order first (moved it,
 *     or, for a cancel, paid it). The order as it is now is in
 *     `details.order` (`OrderDetail`): show it and say so.
 *   - `TRANSITION_NOT_ALLOWED`: this step does not follow from where it is.
 *   - `PAYMENT_IN_FLIGHT`: a payment on it is still being settled: try again
 *     shortly.
 *   - `PAYMENT_NOT_RECEIVED`: a gateway order whose payment never arrived
 *     cannot be moved towards the customer.
 *   - `PAYMENT_REFUNDED`: refunded in full, so nothing is left to fulfil.
 *   - `PREORDER_BALANCE_DUE`: a pre-order whose balance is not paid yet.
 *   - `PREORDER_NOT_READY`: a pre-order that cannot be released yet (its
 *     stock is not in, or other sellers' goods are still awaited).
 *   - `ADDRESS_ON_HOLD`: shipping waits for the customer to check the address.
 *   - `PICKUP_CONSIGNMENT`: collected, not shipped: no tracking to add.
 *   - `CANCEL_NEEDS_REFUND`: cancelling it would give money back. Refunds are
 *     made on the website's dashboard (`Config.store.dashboardUrl`).
 * - 403 AUTHORIZATION_ERROR: `OTHER_SELLERS_ITEMS`: a seller's staff may
 *   change only an order that is wholly their seller's.
 * - 400 VALIDATION_ERROR: `TRACKING_REQUIRED` (with `errors`): `mark_shipped`
 *   needs `carrier` and `trackingNumber`.
 */
export const ORDER_ACTION_REASONS = [
  "ORDER_STATE_CHANGED",
  "TRANSITION_NOT_ALLOWED",
  "PAYMENT_IN_FLIGHT",
  "PAYMENT_NOT_RECEIVED",
  "PAYMENT_REFUNDED",
  "PREORDER_BALANCE_DUE",
  "PREORDER_NOT_READY",
  "ADDRESS_ON_HOLD",
  "PICKUP_CONSIGNMENT",
  "TRACKING_REQUIRED",
  "OTHER_SELLERS_ITEMS",
  "CANCEL_NEEDS_REFUND",
] as const;
export type OrderActionReason = (typeof ORDER_ACTION_REASONS)[number];

/** The answer to POST /orders/{id}/actions: the order after the step. */
export const OrderActionResult = z.object({
  order: OrderDetail,
});
export type OrderActionResult = z.infer<typeof OrderActionResult>;
