/**
 * The shopper's orders: the list, one order, cancelling it, its invoice.
 *
 * Only what the person who placed an order may see of it. A seller's
 * commission, payouts and staff notes never leave the server; an order placed
 * by somebody else answers 404, never 403.
 *
 * Statuses are the store's own words (`pending`, `processing`, `shipped`,
 * `delivered`, `cancelled`, `preordered`, …), passed through: the app shows
 * its own translation of the ones it knows and the word itself otherwise.
 *
 * GET /orders/{id}/invoice answers with the invoice's PDF itself
 * (`application/pdf`), not with JSON; an error is still the JSON envelope.
 *
 * POST /orders/track finds an order placed without an account (see
 * `TrackOrderRequest`); the order comes as `OrderDetail`, cut down to what the
 * website's tracking page shows a guest.
 *
 * "Pay now": an order whose payment never arrived (a gateway page the shopper
 * left, a refused card) carries `payment.payable`. POST /orders/{id}/pay
 * collects what it owes against the same order — no new cart, no new prices —
 * and POST /orders/{id}/pay/verify reports how it went.
 */
import * as z from "zod";

import { PushPayment, StripeIntent } from "./checkout";
import { ImageSet, ListQuery, Money, listOf } from "./common";

/** GET /orders. Newest first. */
export const OrderListQuery = ListQuery.extend({
  /** True: only orders with a pre-order in them. False: only the others. Left out: all. */
  preOrders: z.boolean().optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

/** Where a pre-order stands. */
export const OrderPreOrder = z.object({
  /** The store's own word (`awaiting_stock`, `ready_to_ship`, …). */
  status: z.string().optional(),
  /** When it is expected to ship. */
  releaseDate: z.string().optional(),
});
export type OrderPreOrder = z.infer<typeof OrderPreOrder>;

/** Where a pre-order stands, as the order list shows it. */
export const OrderPreOrderSummary = OrderPreOrder.extend({
  /**
   * What is still owed on a deposit or pay-later pre-order. Left out once
   * nothing is. The order itself says by when, and how to pay it.
   */
  balanceDue: Money.optional(),
});
export type OrderPreOrderSummary = z.infer<typeof OrderPreOrderSummary>;

/** One seller's part of an order that several sellers ship. */
export const OrderShipmentSummary = z.object({
  /** Left out when the seller's store is gone; the app names it generically. */
  vendorName: z.string().optional(),
  status: z.string(),
});
export type OrderShipmentSummary = z.infer<typeof OrderShipmentSummary>;

/** An order as the list shows it. */
export const OrderSummary = z.object({
  id: z.string(),
  /** The number the shopper quotes to the store. */
  number: z.string(),
  /** The least advanced of its shipments, on an order several sellers ship. */
  status: z.string(),
  placedAt: z.string(),
  /** The quantities added up. */
  itemCount: z.number().int(),
  total: Money,
  preOrder: OrderPreOrderSummary.optional(),
  /**
   * One per seller on an order several sellers ship, so the list can say that
   * one parcel arrived while another is on its way. Empty otherwise.
   */
  shipments: z.array(OrderShipmentSummary),
  /**
   * Offer "Request return" on the row: the same answer as the order's own
   * `OrderDetail.canReturn` (at least one line can be returned now). Why an
   * order cannot be is on the order itself.
   */
  canReturn: z.boolean().optional(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

export const OrderList = listOf(OrderSummary);
export type OrderList = z.infer<typeof OrderList>;

export const OrderLine = z.object({
  /** The line's position in the order, which never changes. */
  index: z.number().int(),
  productId: z.string(),
  /**
   * The product's page, as it is today: GET /products/{slug}. An order keeps
   * its lines for good, so it is left out when the product has been deleted
   * since; the line then has nothing to open.
   */
  slug: z.string().optional(),
  variantId: z.string().optional(),
  name: z.string(),
  /** The picture the line was bought with. */
  image: ImageSet.optional(),
  sku: z.string().optional(),
  quantity: z.number().int(),
  unitPrice: Money,
  lineTotal: Money,
  preOrder: OrderPreOrder.optional(),
  /** Sold as final sale: it cannot be returned. */
  finalSale: z.boolean(),
  /**
   * How many of it can still be returned now (returns.ts): 0 when none can.
   * Sent on the shopper's own order, not on a tracked one.
   */
  returnableQuantity: z.number().int().optional(),
  /**
   * Why none of it can be returned, when none can: RETURN_WINDOW_CLOSED,
   * FINAL_SALE, NOT_RETURNABLE (`RETURN_REFUSALS`). Left out while some can,
   * and when all of it already is being or has been returned.
   */
  returnBlockedReason: z.string().optional(),
  /** When this line's return window closes (ISO), once it has started counting. */
  returnWindowEndsAt: z.string().optional(),
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

/** One scan the courier reported. */
export const OrderTrackingEvent = z.object({
  at: z.string(),
  /** The courier's own word for the scan. */
  status: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
});
export type OrderTrackingEvent = z.infer<typeof OrderTrackingEvent>;

/** A parcel: where to follow it, and what the courier has said so far. */
export const OrderTracking = z.object({
  number: z.string().optional(),
  carrier: z.string().optional(),
  /** The courier's tracking page, to open in a browser. */
  url: z.string().optional(),
  /** Newest first. Empty for a parcel booked outside a connected courier. */
  events: z.array(OrderTrackingEvent),
  /**
   * Delivery went wrong, in the courier's words: `code` is `returned` or
   * `failure`. The order's status does not change for it.
   */
  exception: z
    .object({
      code: z.string(),
      message: z.string(),
      at: z.string(),
    })
    .optional(),
});
export type OrderTracking = z.infer<typeof OrderTracking>;

/** One seller's consignment, on an order several sellers ship. */
export const OrderShipment = z.object({
  vendorName: z.string().optional(),
  status: z.string(),
  /** The `index` of each line in this consignment. */
  lineIndexes: z.array(z.number().int()),
  shippedAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  tracking: OrderTracking.optional(),
});
export type OrderShipment = z.infer<typeof OrderShipment>;

/** A collection from the seller instead of a delivery. */
export const OrderPickup = z.object({
  locationName: z.string().optional(),
  address: z.string(),
  instructions: z.string().optional(),
  /** The window to collect in. */
  startAt: z.string(),
  endAt: z.string(),
  /** `scheduled`, `ready` (come and collect) or `collected`. */
  status: z.string(),
});
export type OrderPickup = z.infer<typeof OrderPickup>;

/** What an order costs, as it was charged. */
export const OrderTotals = z.object({
  subtotal: Money,
  shipping: Money,
  tax: Money,
  discount: Money,
  /** Store credit that paid part of it. */
  storeCredit: Money.optional(),
  total: Money,
  /** Money given back so far. */
  refunded: Money.optional(),
});
export type OrderTotals = z.infer<typeof OrderTotals>;

/** A pre-order's schedule, and on a deposit or pay-later one, its balance. */
export const OrderPreOrderDetail = OrderPreOrder.extend({
  /** The first promised date, when the store has moved it. */
  originalReleaseDate: z.string().optional(),
  /** Why the store moved it. */
  delayReason: z.string().optional(),
  paidSoFar: Money.optional(),
  /** What is still owed. Left out once nothing is. */
  balanceDue: Money.optional(),
  /** Pay the balance by then or the pre-order lapses. */
  balanceDueBy: z.string().optional(),
  /**
   * The website's page that takes the balance, signed for this order alone
   * (it needs no sign-in): open it in a browser view. Sent with `balanceDue`.
   */
  balancePayUrl: z.string().optional(),
});
export type OrderPreOrderDetail = z.infer<typeof OrderPreOrderDetail>;

/**
 * Shipping is paused until the shopper checks the delivery address. Sent only
 * while it is. The app shows `message` and offers the order's page on the
 * website to fix the address.
 */
export const OrderAddressHold = z.object({
  /** What is wrong with the address, in words the shopper can act on. */
  message: z.string().optional(),
  /** The store acts on the order (or cancels it) after this. */
  deadlineAt: z.string().optional(),
  /** The shopper said the address is right as it is; the store decides. */
  confirmedAt: z.string().optional(),
});
export type OrderAddressHold = z.infer<typeof OrderAddressHold>;

/**
 * The ways "Pay now" can take the money (POST /orders/{id}/pay `method`). A
 * mobile-money order (`mtn_momo`, `iotec`) is paid the way it was placed: its
 * phone is prompted again.
 */
export const ORDER_PAY_METHODS = ["card", "paypal", "mtn_momo", "iotec"] as const;

/** What an unpaid order still owes, and whether "Pay now" can collect it. */
export const OrderPayment = z.object({
  /**
   * Show "Pay now". False for an order that is paid, cancelled or paid on
   * delivery, and while no way to pay it is set up.
   */
  payable: z.boolean(),
  /** What it owes now; zero when not payable. */
  due: Money,
  /** The ways the store can take it now. Empty when none is set up. */
  methods: z.array(z.enum(ORDER_PAY_METHODS)),
});
export type OrderPayment = z.infer<typeof OrderPayment>;

/** GET /orders/{id} */
export const OrderDetail = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  /** `pending`, `paid`, `partially_paid`, `refunded`, … */
  paymentStatus: z.string(),
  /** The store's code for it: `cod`, `stripe`, `paypal`, … */
  paymentMethod: z.string(),
  placedAt: z.string(),
  cancelledAt: z.string().optional(),
  /** Whether POST /orders/{id}/cancel would be accepted now. */
  canCancel: z.boolean(),
  lines: z.array(OrderLine),
  totals: OrderTotals,
  /** Left out for an order with nothing to ship. */
  shippingAddress: OrderAddress.optional(),
  billingAddress: OrderAddress.optional(),
  /** The delivery option chosen at checkout. */
  shippingMethod: z.string().optional(),
  pickup: OrderPickup.optional(),
  /** The order's parcel. On an order several sellers ship, see `shipments`. */
  tracking: OrderTracking.optional(),
  /** One per seller on an order several sellers ship. Empty otherwise. */
  shipments: z.array(OrderShipment),
  preOrder: OrderPreOrderDetail.optional(),
  addressHold: OrderAddressHold.optional(),
  /** The note the shopper left at checkout. */
  note: z.string().optional(),
  /** "Pay now": sent on the shopper's own order. */
  payment: OrderPayment.optional(),
  /**
   * Show "Return items": at least one line can be returned now (POST
   * /orders/{id}/returns). Sent on the shopper's own order.
   */
  canReturn: z.boolean().optional(),
  /** When the last of its lines' return windows closes (ISO), once counting. */
  returnWindowEndsAt: z.string().optional(),
  /**
   * With `canReturn` false, why, as a word of `RETURN_REFUSALS` (returns.ts),
   * and the store's sentence for it. Left out on an order not delivered yet.
   */
  returnBlockedReason: z.string().optional(),
  returnBlockedMessage: z.string().optional(),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

/** `reason` values of POST /orders/{id}/cancel (409 CONFLICT). */
export const ORDER_CANCEL_REASONS = [
  /** The order has moved on (processing, shipped, …): it can no longer be called off. */
  "NOT_CANCELLABLE",
  /** A mobile-money payment is still waiting for the payer: try again once it settles. */
  "PAYMENT_IN_PROGRESS",
] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];

/** What cancelling did about the money. */
export const OrderCancelRefund = z.object({
  /** The money is on its way back. */
  refunded: z.boolean(),
  amount: Money.optional(),
  /**
   * Money is owed and did not go back by itself: the store has been told and
   * sends it by hand.
   */
  owed: z.boolean(),
});
export type OrderCancelRefund = z.infer<typeof OrderCancelRefund>;

/** POST /orders/{id}/cancel */
export const OrderCancelResult = z.object({
  order: OrderDetail,
  /** Left out when nothing had been paid. */
  refund: OrderCancelRefund.optional(),
});
export type OrderCancelResult = z.infer<typeof OrderCancelResult>;

/**
 * POST /orders/track and POST /orders/track/invoice: an order placed without
 * an account, found by its number and the email or phone it was placed with
 * (the website's "Track order"). No session is read. POST, so the contact
 * never sits in a URL, a log or a cache.
 *
 * /orders/track answers the order as `OrderDetail`, showing what the
 * website's tracking page shows a guest and nothing more: the delivery
 * address's phone masked to its last four digits (`*******2333`); no billing
 * address, no note, no address-hold notice, no pre-order balance;
 * `canCancel` false, and nothing on it can be acted on. /orders/track/invoice
 * answers the invoice's PDF.
 *
 * A wrong number and a wrong contact are the same 404 `NOT_FOUND`. One
 * address may look one order up 5 times per 15 minutes, the website's
 * lookups and the invoice included; then 429.
 */
export const TrackOrderRequest = z.object({
  /** As on the confirmation (`ORD-…`); the case does not matter. */
  orderNumber: z.string().trim().min(1).max(100),
  /**
   * The email address the order was placed with, or a phone number on it:
   * at least 7 digits; spaces, dashes and a leading `+` do not matter.
   */
  contact: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .refine((value) => value.includes("@") || value.replace(/\D/g, "").length >= 7, {
      message: "Enter the email address of the order, or a phone number with at least 7 digits.",
    }),
});
export type TrackOrderRequest = z.infer<typeof TrackOrderRequest>;

/**
 * `reason` values of POST /orders/{id}/pay and /pay/verify, next to the code:
 * - 409 CONFLICT: ORDER_NOT_PAYABLE (paid meanwhile, cancelled, or paid on
 *   delivery — read the order again), PAYMENT_METHOD_UNAVAILABLE (the method
 *   is off, has no keys, or does not take the order's currency),
 *   PAYMENT_FAILED (the gateway refused to start; nothing was charged),
 *   PAYMENT_PENDING (mobile money: the last prompt is still on the phone —
 *   its `PushPayment` is in `details`: wait on that), OUT_OF_STOCK (mobile
 *   money: something on the order sold out meanwhile).
 * - 400 VALIDATION_ERROR: PHONE_INVALID (mobile money: `errors.payerPhone`).
 */
export const ORDER_PAY_REASONS = [
  "ORDER_NOT_PAYABLE",
  "PAYMENT_METHOD_UNAVAILABLE",
  "PAYMENT_FAILED",
  "PAYMENT_PENDING",
  "OUT_OF_STOCK",
  "PHONE_INVALID",
] as const;
export type OrderPayReason = (typeof ORDER_PAY_REASONS)[number];

/** POST /orders/{id}/pay. Send `Idempotency-Key`. */
export const OrderPayRequest = z.object({
  method: z.enum(ORDER_PAY_METHODS),
  /** Mobile money: a number to prompt instead of the one the order was placed with. */
  payerPhone: z.string().min(1).max(30).optional(),
});
export type OrderPayRequest = z.infer<typeof OrderPayRequest>;

/**
 * How the payment is taken: PaymentSheet (`card`), the gateway's page in the
 * in-app browser (`redirect`), or an approval on the shopper's phone (`push`).
 */
export const ORDER_PAY_FLOWS = ["card", "redirect", "push"] as const;

/**
 * POST /orders/{id}/pay: what to open. One object rather than a union, so a
 * flow added later is one more optional part; read the part `flow` names and
 * leave the answer alone when you do not know its flow.
 */
export const OrderPayStart = z.object({
  flow: z.enum(ORDER_PAY_FLOWS),
  method: z.enum(ORDER_PAY_METHODS),
  /** What is collected: everything the order still owes. */
  amount: Money,
  /** `flow` card: what PaymentSheet is set up with. Then POST /orders/{id}/pay/verify with its `paymentIntentId`. */
  card: StripeIntent.optional(),
  /**
   * `flow` redirect: `openAuthSessionAsync(url, returnUrl)`, then POST
   * /orders/{id}/pay/verify — also when the browser was closed without coming back.
   */
  redirect: z
    .object({
      url: z.string(),
      returnUrl: z.string(),
    })
    .optional(),
  /**
   * `flow` push: the prompt to wait on, as after a mobile-money checkout — POST
   * /orders/{id}/pay/verify every `pollIntervalSeconds` until it is not
   * PENDING, or until `expiresAt`.
   */
  push: PushPayment.optional(),
});
export type OrderPayStart = z.infer<typeof OrderPayStart>;

/** POST /orders/{id}/pay/verify */
export const OrderPayVerifyRequest = z.object({
  method: z.enum(ORDER_PAY_METHODS),
  /** `card`: the PaymentSheet's PaymentIntent (`OrderPayStart.card.paymentIntentId`). */
  paymentIntentId: z.string().min(1).max(255).optional(),
  /**
   * `paypal`: the query of the app link the browser came back on, as it
   * arrived (`RedirectVerifyRequest.returnParams`). Leave out when the browser
   * was closed without coming back.
   */
  returnParams: z.record(z.string().max(64), z.string().max(1000)).optional(),
});
export type OrderPayVerifyRequest = z.infer<typeof OrderPayVerifyRequest>;

export const ORDER_PAY_STATUSES = [
  /** The order is paid. */
  "PAID",
  /** Not finished yet (the card is still being confirmed, the payer has not approved): ask again shortly. */
  "PENDING",
  /** The payment did not go through: `reason`. The order still owes it; "Pay now" again. */
  "FAILED",
  /** The shopper gave up at the gateway, or the order was called off: `reason`. */
  "CANCELLED",
] as const;

/** POST /orders/{id}/pay/verify: how the payment went. The order answers `payment` afresh. */
export const OrderPayVerification = z.object({
  status: z.enum(ORDER_PAY_STATUSES),
  /** FAILED or CANCELLED: DECLINED, NOT_COMPLETED, PAYER_CANCELLED, ORDER_CANCELLED, DUPLICATE_REFUNDED. */
  reason: z.string().optional(),
});
export type OrderPayVerification = z.infer<typeof OrderPayVerification>;
